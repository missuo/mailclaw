import { createId } from "@paralleldrive/cuid2";
import PostalMime from "postal-mime";
import { enrichEmail } from "@/ai/enrich";
import { insertAttachment, insertEmail } from "@/database/d1";
import { pushNewEmail } from "@/push/apns";
import { now } from "@/utils/helpers";
import { processEmailContent } from "@/utils/mail";

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

		const { success, error } = await insertEmail(env.D1, {
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
		});

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

		// Push after storage succeeds; failures are logged inside and never
		// bubble up to the email handler.
		ctx.waitUntil(
			pushNewEmail(env, {
				id: emailId,
				from_address: message.from,
				to_address: message.to,
				subject: parsed.subject || null,
			}),
		);

		// Summary + translation are generated here so every client sees them
		// immediately instead of each device paying the latency itself.
		ctx.waitUntil(enrichEmail(env, emailId));

		console.log(
			`Email ${emailId} stored: ${message.from} → ${message.to} (${attachments.length} attachment(s))`,
		);
	} catch (error) {
		console.error("Failed to process email:", error);
		throw error;
	}
}
