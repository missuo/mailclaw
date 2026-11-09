import { getEmailById, updateSummary, updateTranslation } from "@/database/d1";
import { getSettings } from "@/database/settings";
import type { Email } from "@/types";
import { complete, getLLMConfig } from "./llm";

// Marker the model returns when a translation would be pointless.
export const TRANSLATION_SKIP = "SKIP";

const MAX_BODY_CHARS = 16000;

function bodyOf(email: Email): { text: string; isHTML: boolean } | null {
	if (email.html_content) return { text: email.html_content, isHTML: true };
	if (email.text_content) return { text: email.text_content, isHTML: false };
	return null;
}

export async function generateSummary(
	env: CloudflareBindings,
	email: Email,
	language: string,
): Promise<string | null> {
	const config = getLLMConfig(env);
	const body = bodyOf(email);
	if (!config || !body) return null;

	const system =
		`You summarize emails. Reply with only the summary, 1-2 short sentences, ` +
		`no preamble. Write the summary in ${language}.`;
	const user = [
		`From: ${email.from_address}`,
		`Subject: ${email.subject ?? "(none)"}`,
		"",
		body.text.slice(0, MAX_BODY_CHARS),
	].join("\n");

	const text = await complete(config, system, user);
	return text || null;
}

export async function generateTranslation(
	env: CloudflareBindings,
	email: Email,
	language: string,
): Promise<string | null> {
	const config = getLLMConfig(env);
	const body = bodyOf(email);
	if (!config || !body) return null;

	const system =
		`You translate emails into ${language}. Preserve the original formatting ` +
		`and structure exactly${
			body.isHTML ? " — the content is HTML, reply with the translated HTML only" : ""
		}. Do not translate email addresses, URLs, code, or proper nouns. If the ` +
		`content is already written in ${language}, reply with exactly ` +
		`${TRANSLATION_SKIP} and nothing else. No commentary.`;

	const text = await complete(config, system, body.text.slice(0, MAX_BODY_CHARS), 16384);
	return text || null;
}

// Generates summary + translation for a freshly stored inbound email and
// writes them back. Never throws: enrichment must not break ingestion.
export async function enrichEmail(env: CloudflareBindings, emailId: string): Promise<void> {
	if (!getLLMConfig(env)) return;

	try {
		const { email } = await getEmailById(env.D1, emailId);
		if (!email) return;

		const settings = await getSettings(env.D1);

		const tasks: Promise<unknown>[] = [];

		if (settings.auto_summarize !== false) {
			tasks.push(
				generateSummary(env, email, settings.summary_language)
					.then((summary) =>
						summary ? updateSummary(env.D1, emailId, summary, settings.summary_language) : null,
					)
					.catch((error) => console.error("Summary failed:", error)),
			);
		}

		if (settings.auto_translate === true) {
			tasks.push(
				generateTranslation(env, email, settings.translation_language)
					.then((translation) =>
						translation
							? updateTranslation(env.D1, emailId, translation, settings.translation_language)
							: null,
					)
					.catch((error) => console.error("Translation failed:", error)),
			);
		}

		await Promise.allSettled(tasks);
	} catch (error) {
		console.error("Enrichment failed:", error);
	}
}
