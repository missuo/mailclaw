import { createId } from "@paralleldrive/cuid2";
import PostalMime from "postal-mime";
import { type Analysis, analyzeAndStore, translateAndStore } from "@/ai/enrich";
import { type InsertEmailInput, insertAttachment, insertEmail } from "@/database/d1";
import { getSettings } from "@/database/settings";
import { pushNewEmail } from "@/push/apns";
import { isHiddenInApp } from "@/utils/filter-rules";
import { now } from "@/utils/helpers";
import { processEmailContent } from "@/utils/mail";

// How long the push waits for AI analysis (so it can show the OTP) before
// going out without it. Analysis typically takes 2-3 s.
const PUSH_WAIT_FOR_AI_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	return Promise.race([
		promise,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
	]);
}

export async function handleEmail(
	message: ForwardableEmailMessage,
	env: CloudflareBindings,
	ctx: ExecutionContext,
) {
	try {
		const emailId = createId();
		const parsed = await PostalMime.parse(message.raw);

		const { htmlContent, textContent } = processEmailContent(
			parsed.html ?? null,
			parsed.text ?? null,
		);

		const hasAttachments = (parsed.attachments?.length ?? 0) > 0;
		const receivedAt = now();

		const email: InsertEmailInput = {
			id: emailId,
			from_address: message.from,
			to_address: message.to,
			subject: parsed.subject || null,
			received_at: receivedAt,
			html_content: htmlContent,
			text_content: textContent,
			has_attachments: hasAttachments,
			attachment_count: parsed.attachments?.length ?? 0,
			direction: "inbound",
			message_id: parsed.messageId || null,
			in_reply_to: parsed.inReplyTo || null,
			references_header: parsed.references || null,
			read: false,
			starred: false,
			archived: false,
			deleted_at: null,
			updated_at: receivedAt,
			summary: null,
			summary_lang: null,
			translation: null,
			translation_lang: null,
			otp: null,
		};
		const { success, error } = await insertEmail(env.D1, email);

		if (!success) {
			throw new Error(`Failed to insert email: ${error}`);
		}

		const attachments = parsed.attachments ?? [];
		for (const attachment of attachments) {
			const attachmentId = createId();
			const r2Key = `${emailId}/${attachmentId}`;

			// postal-mime gives ArrayBuffer for binary parts and string for text parts.
			const body =
				typeof attachment.content === "string"
					? new TextEncoder().encode(attachment.content)
					: new Uint8Array(attachment.content);

			await env.ATTACHMENTS.put(r2Key, body, {
				httpMetadata: attachment.mimeType ? { contentType: attachment.mimeType } : undefined,
			});

			const { success: attachmentSaved, error: attachmentError } = await insertAttachment(env.D1, {
				id: attachmentId,
				email_id: emailId,
				filename: attachment.filename || null,
				mime_type: attachment.mimeType || null,
				size: body.byteLength,
				r2_key: r2Key,
				created_at: receivedAt,
			});

			if (!attachmentSaved) {
				// Roll back the orphaned R2 object so storage stays consistent.
				await env.ATTACHMENTS.delete(r2Key);
				throw new Error(`Failed to insert attachment: ${attachmentError}`);
			}
		}

		// Everything below runs after storage succeeded and never fails ingestion.
		const settings = await getSettings(env.D1);
		if (isHiddenInApp(settings.filter_rules, email)) {
			// Hidden in the app by an Include/Exclude rule: still stored and served
			// by the API, but no AI spend and no push.
			console.log(`Email ${emailId} filtered for app: ${message.from} → ${message.to}`);
			return;
		}

		// Analysis (summary + OTP) gates the push so a verification code shows
		// up in the notification; translation follows in the background.
		const analysis: Promise<Analysis | null> = analyzeAndStore(env, email, settings);
		ctx.waitUntil(
			withTimeout(analysis, PUSH_WAIT_FOR_AI_MS).then((result) =>
				pushNewEmail(env, {
					id: emailId,
					from_address: message.from,
					to_address: message.to,
					subject: parsed.subject || null,
					otp: result?.otp ?? null,
					summary: result?.summary ?? null,
				}),
			),
		);
		ctx.waitUntil(analysis.then((result) => translateAndStore(env, email, settings, result)));

		console.log(
			`Email ${emailId} stored: ${message.from} → ${message.to} (${attachments.length} attachment(s))`,
		);
	} catch (error) {
		console.error("Failed to process email:", error);
		throw error;
	}
}
