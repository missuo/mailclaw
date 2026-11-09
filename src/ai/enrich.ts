import { type Segmented, segmentHTML, segmentText } from "@/ai/segments";
import { aiEnabled, completeJSON } from "@/ai/workers-ai";
import { updateAnalysis, updateTranslation } from "@/database/d1";
import type { Settings } from "@/database/settings";
import type { Email } from "@/types";

// Stored as the translation when the email is already in the target
// language, so clients know not to translate it themselves.
export const TRANSLATION_SKIP = "SKIP";

const MAX_ANALYSIS_CHARS = 12000;
// Per-request translation chunk, and a hard cap per email so a giant
// newsletter cannot run up the bill. Text past the cap stays untranslated.
const TRANSLATION_CHUNK_CHARS = 3000;
const MAX_TRANSLATION_CHARS = 40000;
const TRANSLATION_CONCURRENCY = 4;

export interface Analysis {
	summary: string | null;
	otp: string | null;
	service: string | null;
	// False when the email is already written in the translation language.
	needs_translation: boolean;
}

function plainBody(email: Email): string {
	if (email.text_content) return email.text_content;
	if (email.html_content) {
		return email.html_content
			.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ");
	}
	return "";
}

// Guards against a hallucinated code: the OTP must literally appear in the
// email (ignoring whitespace, which the model is told to drop).
function otpAppearsIn(otp: string, email: Email): boolean {
	const haystack = `${email.subject ?? ""}\n${plainBody(email)}`.replace(/\s+/g, "");
	return haystack.includes(otp.replace(/\s+/g, ""));
}

export function otpSummary(service: string | null, otp: string): string {
	return service ? `${service} OTP: ${otp}` : `OTP: ${otp}`;
}

// One call returns the summary, any one-time code, and whether a translation
// is worthwhile — the push waits on this, so it has to be a single round trip.
export async function analyzeEmail(
	env: CloudflareBindings,
	email: Email,
	options: { summaryLanguage: string; translationLanguage?: string },
): Promise<Analysis> {
	const properties: Record<string, unknown> = {
		otp: { type: ["string", "null"] },
		service: { type: ["string", "null"] },
		summary: { type: "string" },
	};
	const lines = [
		"You read one incoming email and return JSON.",
		"- otp: the one-time code the recipient must type in to verify, sign in, confirm, or " +
			"complete 2FA. Copy it exactly as shown, keeping letters, case and hyphens, but drop " +
			"spaces inside it. It is NOT an order/tracking/reference/ticket number, amount, phone " +
			"number, date, or a link/token in a URL. null when the email has no such code.",
		'- service: the short brand or product name the code is for (e.g. "ChatGPT", "Apple"); ' +
			"null when unclear.",
		`- summary: 1-2 short sentences in ${options.summaryLanguage} summarizing the email, no preamble.`,
	];
	if (options.translationLanguage) {
		properties.needs_translation = { type: "boolean" };
		lines.push(
			`- needs_translation: false if the email is already written in ${options.translationLanguage}, otherwise true.`,
		);
	}

	const user = [
		`From: ${email.from_address}`,
		`Subject: ${email.subject ?? "(none)"}`,
		"",
		plainBody(email).slice(0, MAX_ANALYSIS_CHARS),
	].join("\n");

	const result = await completeJSON<{
		otp: string | null;
		service: string | null;
		summary: string;
		needs_translation?: boolean;
	}>(
		env,
		"analysis",
		[
			{ role: "system", content: lines.join("\n") },
			{ role: "user", content: user },
		],
		{
			type: "object",
			properties,
			required: Object.keys(properties),
			additionalProperties: false,
		},
		600,
	);

	const otp = result.otp?.replace(/\s+/g, "") || null;
	const verifiedOtp = otp && otpAppearsIn(otp, email) ? otp : null;
	return {
		summary: result.summary?.trim() || null,
		otp: verifiedOtp,
		service: verifiedOtp ? result.service?.trim() || null : null,
		needs_translation: result.needs_translation !== false,
	};
}

async function translateChunk(
	env: CloudflareBindings,
	items: string[],
	language: string,
): Promise<string[] | null> {
	const system =
		`Translate each item of the JSON array into ${language}. The items are consecutive ` +
		"fragments of one email. Placeholders like <g1>…</g1> and <g2/> stand for formatting: " +
		"keep every placeholder exactly once, around the matching translated words. Keep HTML " +
		"entities as they are. Do not translate email addresses, URLs, code, or brand and " +
		`product names. Items already in ${language} are returned unchanged. Return ` +
		`{"translations": [...]} with exactly ${items.length} items, in the same order.`;

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const { translations } = await completeJSON<{ translations: string[] }>(
				env,
				"translation",
				[
					{ role: "system", content: system },
					{ role: "user", content: JSON.stringify(items) },
				],
				{
					type: "object",
					properties: {
						translations: {
							type: "array",
							items: { type: "string" },
							minItems: items.length,
							maxItems: items.length,
						},
					},
					required: ["translations"],
					additionalProperties: false,
				},
				8192,
			);
			if (Array.isArray(translations) && translations.length === items.length) {
				return translations;
			}
		} catch (error) {
			console.error("Translation chunk failed:", error);
		}
	}
	return null;
}

// Translates only the text of the email (see segments.ts) and rebuilds the
// original structure around it. Untranslatable chunks keep the original text.
export async function translateEmail(
	env: CloudflareBindings,
	email: Email,
	language: string,
): Promise<string | null> {
	let segmented: Segmented;
	if (email.html_content) segmented = segmentHTML(email.html_content);
	else if (email.text_content) segmented = segmentText(email.text_content);
	else return null;

	const { segments } = segmented;
	if (segments.length === 0) return null;

	// Group consecutive segments into chunks under the size budget.
	const chunks: { start: number; items: string[] }[] = [];
	let budget = MAX_TRANSLATION_CHARS;
	let current: { start: number; items: string[]; size: number } | null = null;
	for (let i = 0; i < segments.length; i++) {
		const size = segments[i].length;
		if (budget - size < 0) break;
		budget -= size;
		if (!current || current.size + size > TRANSLATION_CHUNK_CHARS) {
			current = { start: i, items: [], size: 0 };
			chunks.push(current);
		}
		current.items.push(segments[i]);
		current.size += size;
	}

	const translated = [...segments];
	let anyTranslated = false;
	for (let i = 0; i < chunks.length; i += TRANSLATION_CONCURRENCY) {
		const batch = chunks.slice(i, i + TRANSLATION_CONCURRENCY);
		const results = await Promise.all(
			batch.map((chunk) => translateChunk(env, chunk.items, language)),
		);
		results.forEach((result, j) => {
			if (!result) return;
			anyTranslated = true;
			result.forEach((text, k) => {
				translated[batch[j].start + k] = text;
			});
		});
	}

	return anyTranslated ? segmented.rebuild(translated) : null;
}

// Runs analysis for an inbound email and stores the result. Resolves to the
// analysis (or null on failure) so the push can include the OTP. Never throws.
export async function analyzeAndStore(
	env: CloudflareBindings,
	email: Email,
	settings: Settings,
): Promise<Analysis | null> {
	if (!aiEnabled(env)) return null;
	const wantSummary = settings.auto_summarize;
	const wantOtp = settings.otp_detection;
	const wantTranslation = settings.auto_translate;
	if (!wantSummary && !wantOtp && !wantTranslation) return null;

	try {
		const analysis = await analyzeEmail(env, email, {
			summaryLanguage: settings.summary_language,
			translationLanguage: wantTranslation ? settings.translation_language : undefined,
		});

		// An OTP always becomes the summary ("Craftail OTP: 123456"); a regular
		// summary is only kept when auto-summarize is on.
		const otp = wantOtp ? analysis.otp : null;
		const summary = otp ? otpSummary(analysis.service, otp) : wantSummary ? analysis.summary : null;
		if (summary || otp) {
			await updateAnalysis(env.D1, email.id, {
				summary,
				summary_lang: summary ? settings.summary_language : null,
				otp,
			});
		}
		return { ...analysis, otp, summary };
	} catch (error) {
		console.error("Analysis failed:", error);
		return null;
	}
}

// Translates an inbound email when auto-translate is on. Never throws.
export async function translateAndStore(
	env: CloudflareBindings,
	email: Email,
	settings: Settings,
	analysis: Analysis | null,
): Promise<void> {
	if (!aiEnabled(env) || !settings.auto_translate) return;
	const language = settings.translation_language;
	try {
		if (analysis && !analysis.needs_translation) {
			await updateTranslation(env.D1, email.id, TRANSLATION_SKIP, language);
			return;
		}
		const translation = await translateEmail(env, email, language);
		if (translation) await updateTranslation(env.D1, email.id, translation, language);
	} catch (error) {
		console.error("Translation failed:", error);
	}
}
