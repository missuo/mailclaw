import { createId } from "@paralleldrive/cuid2";
import { Hono } from "hono";
import * as db from "@/database/d1";
import { createEmailProvider } from "@/providers";
import type { EmailFilters, EmailPatch, Mailbox, SendEmailRequest } from "@/types";
import { base64ToUint8Array, now, parseTimestamp } from "@/utils/helpers";
import { ERR, OK } from "@/utils/http";

const MAILBOXES: Mailbox[] = ["inbox", "sent", "archive", "trash", "starred", "all"];
const PATCH_FIELDS = ["read", "starred", "archived", "deleted"] as const;
// Cloudflare's Email Sending limit for the whole message.
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

const emails = new Hono<{ Bindings: CloudflareBindings }>();

function parseFilters(query: Record<string, string>): EmailFilters {
	const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
	const offset = Math.max(Number(query.offset) || 0, 0);

	return {
		from: query.from || undefined,
		to: query.to || undefined,
		q: query.q || undefined,
		after: query.after ? (parseTimestamp(query.after) ?? undefined) : undefined,
		before: query.before ? (parseTimestamp(query.before) ?? undefined) : undefined,
		mailbox: MAILBOXES.includes(query.mailbox as Mailbox) ? (query.mailbox as Mailbox) : undefined,
		updated_after: query.updated_after
			? (parseTimestamp(query.updated_after) ?? undefined)
			: undefined,
		limit,
		offset,
	};
}

// List emails (metadata only)
emails.get("/api/emails", async (c) => {
	const filters = parseFilters(c.req.query());
	const { emails: results, total, error } = await db.getEmails(c.env.D1, filters);

	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	return c.json(OK({ emails: results, total, limit: filters.limit, offset: filters.offset }));
});

// Export emails (with full content)
emails.get("/api/emails/export", async (c) => {
	const filters = parseFilters(c.req.query());
	const { emails: results, total, error } = await db.getEmailsExport(c.env.D1, filters);

	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	return c.json(OK({ emails: results, total, limit: filters.limit, offset: filters.offset }));
});

// List attachment metadata for an email
emails.get("/api/emails/:id/attachments", async (c) => {
	const emailId = c.req.param("id");

	const { email, error: emailError } = await db.getEmailById(c.env.D1, emailId);
	if (emailError) return c.json(ERR("D1_ERROR", emailError.message), 500);
	if (!email) return c.json(ERR("NOT_FOUND", "Email not found"), 404);

	const { attachments, error } = await db.getAttachmentsByEmailId(c.env.D1, emailId);
	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	return c.json(OK({ attachments, total: attachments.length }));
});

// Download a single attachment (raw binary, not the JSON envelope)
emails.get("/api/emails/:id/attachments/:attachmentId", async (c) => {
	const emailId = c.req.param("id");
	const attachmentId = c.req.param("attachmentId");

	const { attachment, error } = await db.getAttachmentById(c.env.D1, emailId, attachmentId);
	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	if (!attachment) return c.json(ERR("NOT_FOUND", "Attachment not found"), 404);

	const object = await c.env.ATTACHMENTS.get(attachment.r2_key);
	if (!object) return c.json(ERR("NOT_FOUND", "Attachment content missing"), 404);

	const filename = attachment.filename || attachment.id;
	// RFC 5987 encoding so non-ASCII filenames survive the header.
	const encodedName = encodeURIComponent(filename);
	c.header("Content-Type", attachment.mime_type || "application/octet-stream");
	c.header("Content-Length", String(attachment.size));
	c.header(
		"Content-Disposition",
		`attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodedName}`,
	);
	return c.body(object.body);
});

// Get single email
emails.get("/api/emails/:id", async (c) => {
	const { email, error } = await db.getEmailById(c.env.D1, c.req.param("id"));

	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	if (!email) return c.json(ERR("NOT_FOUND", "Email not found"), 404);
	return c.json(OK(email));
});

// Update client-facing flags (read/starred/archived) or move in/out of Trash
emails.patch("/api/emails/:id", async (c) => {
	const emailId = c.req.param("id");

	let body: EmailPatch;
	try {
		body = await c.req.json<EmailPatch>();
	} catch {
		return c.json(ERR("INVALID_BODY", "Request body must be valid JSON"), 400);
	}

	const patch: EmailPatch = {};
	for (const field of PATCH_FIELDS) {
		const value = body[field];
		if (value === undefined) continue;
		if (typeof value !== "boolean") {
			return c.json(ERR("INVALID_FIELD", `${field} must be a boolean`), 400);
		}
		patch[field] = value;
	}

	if (Object.keys(patch).length === 0) {
		return c.json(
			ERR("MISSING_FIELDS", "At least one of read, starred, archived, deleted is required"),
			400,
		);
	}

	const { updated, error } = await db.patchEmail(c.env.D1, emailId, patch, now());
	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	if (!updated) return c.json(ERR("NOT_FOUND", "Email not found"), 404);

	const { email, error: getError } = await db.getEmailById(c.env.D1, emailId);
	if (getError) return c.json(ERR("D1_ERROR", getError.message), 500);
	return c.json(OK(email));
});

// Delete: soft (Trash) by default, ?permanent=true removes the row and R2 objects
emails.delete("/api/emails/:id", async (c) => {
	const emailId = c.req.param("id");
	const permanent = c.req.query("permanent") === "true";

	if (!permanent) {
		const { deleted, error } = await db.softDeleteEmailById(c.env.D1, emailId, now());
		if (error) return c.json(ERR("D1_ERROR", error.message), 500);
		if (deleted) return c.json(OK({ message: "Email moved to trash" }));

		// Nothing changed: either the email doesn't exist or it's already in Trash.
		const { email, error: getError } = await db.getEmailById(c.env.D1, emailId);
		if (getError) return c.json(ERR("D1_ERROR", getError.message), 500);
		if (!email) return c.json(ERR("NOT_FOUND", "Email not found"), 404);
		return c.json(OK({ message: "Email already in trash" }));
	}

	const { keys, error: keysError } = await db.getAttachmentKeysByEmailId(c.env.D1, emailId);
	if (keysError) return c.json(ERR("D1_ERROR", keysError.message), 500);

	const { deleted, error } = await db.deleteEmailById(c.env.D1, emailId);
	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	if (!deleted) return c.json(ERR("NOT_FOUND", "Email not found"), 404);

	if (keys.length > 0) {
		await c.env.ATTACHMENTS.delete(keys);
	}
	return c.json(OK({ message: "Email deleted" }));
});

// Send email
emails.post("/api/emails/send", async (c) => {
	let body: SendEmailRequest;
	try {
		body = await c.req.json<SendEmailRequest>();
	} catch {
		return c.json(ERR("INVALID_BODY", "Request body must be valid JSON"), 400);
	}

	if (!body.from || !body.to || !body.subject) {
		return c.json(ERR("MISSING_FIELDS", "from, to, and subject are required"), 400);
	}

	if (!body.html && !body.text) {
		return c.json(ERR("MISSING_CONTENT", "Either html or text content is required"), 400);
	}

	// Decode attachments up front so malformed base64 is a 400, not a provider error.
	const attachmentBodies: { bytes: Uint8Array; filename: string; type: string }[] = [];
	if (body.attachments) {
		let totalBytes = 0;
		for (const attachment of body.attachments) {
			if (!attachment.filename || !attachment.type || !attachment.content) {
				return c.json(
					ERR("INVALID_ATTACHMENT", "Each attachment requires filename, type, and content"),
					400,
				);
			}
			let bytes: Uint8Array;
			try {
				bytes = base64ToUint8Array(attachment.content);
			} catch {
				return c.json(
					ERR("INVALID_ATTACHMENT", `Attachment ${attachment.filename} is not valid base64`),
					400,
				);
			}
			totalBytes += bytes.byteLength;
			attachmentBodies.push({ bytes, filename: attachment.filename, type: attachment.type });
		}
		if (totalBytes > MAX_MESSAGE_BYTES) {
			return c.json(ERR("CONTENT_TOO_LARGE", "Attachments exceed the 25 MiB message limit"), 400);
		}
	}

	let result: { id: string; provider: string };
	try {
		const provider = createEmailProvider(c.env);
		result = await provider.send(body);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to send email";
		return c.json(ERR("SEND_FAILED", message), 500);
	}

	// Persist the outbound copy so clients get a Sent mailbox. A persistence
	// failure must not fail the request — the mail is already on the wire.
	let persistedId: string | undefined;
	try {
		const emailId = createId();
		const timestamp = now();
		const toJoined = (Array.isArray(body.to) ? body.to : [body.to]).join(", ");

		const { success, error } = await db.insertEmail(c.env.D1, {
			id: emailId,
			from_address: body.from,
			to_address: toJoined,
			subject: body.subject,
			received_at: timestamp,
			html_content: body.html ?? null,
			text_content: body.text ?? null,
			has_attachments: attachmentBodies.length > 0,
			attachment_count: attachmentBodies.length,
			direction: "outbound",
			message_id: result.id || null,
			in_reply_to: body.headers?.["In-Reply-To"] ?? null,
			references_header: body.headers?.References ?? null,
			read: true,
			starred: false,
			archived: false,
			deleted_at: null,
			updated_at: timestamp,
		});
		if (!success) throw error ?? new Error("insert failed");

		for (const attachment of attachmentBodies) {
			const attachmentId = createId();
			const r2Key = `${emailId}/${attachmentId}`;
			await c.env.ATTACHMENTS.put(r2Key, attachment.bytes.slice().buffer, {
				httpMetadata: { contentType: attachment.type },
			});
			await db.insertAttachment(c.env.D1, {
				id: attachmentId,
				email_id: emailId,
				filename: attachment.filename,
				mime_type: attachment.type,
				size: attachment.bytes.byteLength,
				r2_key: r2Key,
				created_at: timestamp,
			});
		}

		persistedId = emailId;
	} catch (err) {
		console.error("Failed to persist outbound email:", err);
	}

	return c.json(OK({ ...result, ...(persistedId ? { email_id: persistedId } : {}) }));
});

export default emails;
