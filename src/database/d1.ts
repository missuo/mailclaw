import type {
	Attachment,
	AttachmentSummary,
	Device,
	Email,
	EmailFilters,
	EmailPatch,
	EmailSummary,
} from "@/types";

const EMAIL_COLUMNS =
	"id, from_address, to_address, subject, received_at, html_content, text_content, has_attachments, attachment_count, direction, message_id, in_reply_to, references_header, read, starred, archived, deleted_at, updated_at";

const SUMMARY_COLUMNS =
	"id, from_address, to_address, subject, received_at, has_attachments, attachment_count, direction, message_id, in_reply_to, references_header, read, starred, archived, deleted_at, updated_at";

function mapEmailRow<T extends Record<string, unknown>>(row: T) {
	return {
		...row,
		has_attachments: Boolean(row.has_attachments),
		read: Boolean(row.read),
		starred: Boolean(row.starred),
		archived: Boolean(row.archived),
	};
}

export type InsertEmailInput = Omit<Email, "attachments">;

const INSERT_COLUMNS =
	"id, from_address, to_address, subject, received_at, html_content, text_content, has_attachments, attachment_count, direction, message_id, in_reply_to, references_header, read, starred, archived, deleted_at, updated_at";

export async function insertEmail(db: D1Database, email: InsertEmailInput) {
	try {
		const { success, error } = await db
			.prepare(
				`INSERT INTO emails (${INSERT_COLUMNS})
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				email.id,
				email.from_address,
				email.to_address,
				email.subject,
				email.received_at,
				email.html_content,
				email.text_content,
				email.has_attachments,
				email.attachment_count,
				email.direction,
				email.message_id,
				email.in_reply_to,
				email.references_header,
				email.read,
				email.starred,
				email.archived,
				email.deleted_at,
				email.updated_at,
			)
			.run();
		return { success, error };
	} catch (e: unknown) {
		return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

function buildWhereClause(filters: EmailFilters): { where: string; params: unknown[] } {
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (filters.from) {
		conditions.push("from_address LIKE ?");
		params.push(`%${filters.from}%`);
	}
	if (filters.to) {
		conditions.push("to_address LIKE ?");
		params.push(`%${filters.to}%`);
	}
	if (filters.q) {
		conditions.push("(subject LIKE ? OR text_content LIKE ?)");
		const keyword = `%${filters.q}%`;
		params.push(keyword, keyword);
	}
	if (filters.after) {
		conditions.push("received_at >= ?");
		params.push(filters.after);
	}
	if (filters.before) {
		conditions.push("received_at <= ?");
		params.push(filters.before);
	}
	if (filters.updated_after !== undefined) {
		conditions.push("updated_at > ?");
		params.push(filters.updated_after);
	}

	switch (filters.mailbox) {
		case "inbox":
			conditions.push("direction = 'inbound'", "archived = FALSE", "deleted_at IS NULL");
			break;
		case "sent":
			conditions.push("direction = 'outbound'", "deleted_at IS NULL");
			break;
		case "archive":
			conditions.push("archived = TRUE", "deleted_at IS NULL");
			break;
		case "trash":
			conditions.push("deleted_at IS NOT NULL");
			break;
		case "starred":
			conditions.push("starred = TRUE", "deleted_at IS NULL");
			break;
		case "all":
			// No constraint: everything, including Trash.
			break;
		default:
			// Delta-sync queries must see tombstones; plain listings hide Trash.
			if (filters.updated_after === undefined) {
				conditions.push("deleted_at IS NULL");
			}
			break;
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	return { where, params };
}

// Delta-sync queries page by updated_at ascending so the last row is the next cursor.
function orderClause(filters: EmailFilters): string {
	return filters.updated_after !== undefined
		? "ORDER BY updated_at ASC"
		: "ORDER BY received_at DESC";
}

export async function getEmails(db: D1Database, filters: EmailFilters) {
	try {
		const { where, params } = buildWhereClause(filters);

		const countResult = await db
			.prepare(`SELECT COUNT(*) as total FROM emails ${where}`)
			.bind(...params)
			.first<{ total: number }>();

		const { results } = await db
			.prepare(
				`SELECT ${SUMMARY_COLUMNS} FROM emails ${where}
				 ${orderClause(filters)}
				 LIMIT ? OFFSET ?`,
			)
			.bind(...params, filters.limit, filters.offset)
			.all();

		const emails = results.map(mapEmailRow) as EmailSummary[];

		return { emails, total: countResult?.total ?? 0, error: undefined };
	} catch (e: unknown) {
		return { emails: [], total: 0, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function getEmailsExport(db: D1Database, filters: EmailFilters) {
	try {
		const { where, params } = buildWhereClause(filters);

		const countResult = await db
			.prepare(`SELECT COUNT(*) as total FROM emails ${where}`)
			.bind(...params)
			.first<{ total: number }>();

		const { results } = await db
			.prepare(
				`SELECT ${EMAIL_COLUMNS} FROM emails ${where}
				 ${orderClause(filters)}
				 LIMIT ? OFFSET ?`,
			)
			.bind(...params, filters.limit, filters.offset)
			.all();

		const emails = results.map(mapEmailRow) as unknown as Email[];

		return { emails, total: countResult?.total ?? 0, error: undefined };
	} catch (e: unknown) {
		return { emails: [], total: 0, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function getEmailById(db: D1Database, id: string) {
	try {
		const result = await db
			.prepare(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE id = ?`)
			.bind(id)
			.first();
		if (!result) return { email: null, error: undefined };

		const { results: attachmentRows } = await db
			.prepare(
				`SELECT id, email_id, filename, mime_type, size, created_at
				 FROM attachments WHERE email_id = ? ORDER BY created_at ASC`,
			)
			.bind(id)
			.all();

		const email = {
			...mapEmailRow(result),
			attachments: attachmentRows as unknown as AttachmentSummary[],
		} as Email;

		return { email, error: undefined };
	} catch (e: unknown) {
		return { email: null, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function patchEmail(db: D1Database, id: string, patch: EmailPatch, timestamp: number) {
	const sets: string[] = ["updated_at = ?"];
	const params: unknown[] = [timestamp];

	if (patch.read !== undefined) {
		sets.push("read = ?");
		params.push(patch.read);
	}
	if (patch.starred !== undefined) {
		sets.push("starred = ?");
		params.push(patch.starred);
	}
	if (patch.archived !== undefined) {
		sets.push("archived = ?");
		params.push(patch.archived);
	}
	if (patch.deleted !== undefined) {
		sets.push("deleted_at = ?");
		params.push(patch.deleted ? timestamp : null);
	}

	try {
		const { meta } = await db
			.prepare(`UPDATE emails SET ${sets.join(", ")} WHERE id = ?`)
			.bind(...params, id)
			.run();
		return { updated: (meta?.changes ?? 0) > 0, error: undefined };
	} catch (e: unknown) {
		return { updated: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function softDeleteEmailById(db: D1Database, id: string, timestamp: number) {
	try {
		const { meta } = await db
			.prepare(
				"UPDATE emails SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
			)
			.bind(timestamp, timestamp, id)
			.run();
		return { deleted: (meta?.changes ?? 0) > 0, error: undefined };
	} catch (e: unknown) {
		return { deleted: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function insertAttachment(db: D1Database, attachment: Attachment) {
	try {
		const { success, error } = await db
			.prepare(
				`INSERT INTO attachments (id, email_id, filename, mime_type, size, r2_key, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				attachment.id,
				attachment.email_id,
				attachment.filename,
				attachment.mime_type,
				attachment.size,
				attachment.r2_key,
				attachment.created_at,
			)
			.run();
		return { success, error };
	} catch (e: unknown) {
		return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function getAttachmentsByEmailId(db: D1Database, emailId: string) {
	try {
		const { results } = await db
			.prepare(
				`SELECT id, email_id, filename, mime_type, size, created_at
				 FROM attachments WHERE email_id = ? ORDER BY created_at ASC`,
			)
			.bind(emailId)
			.all();
		return { attachments: results as unknown as AttachmentSummary[], error: undefined };
	} catch (e: unknown) {
		return { attachments: [], error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function getAttachmentById(db: D1Database, emailId: string, attachmentId: string) {
	try {
		const result = await db
			.prepare(
				`SELECT id, email_id, filename, mime_type, size, r2_key, created_at
				 FROM attachments WHERE id = ? AND email_id = ?`,
			)
			.bind(attachmentId, emailId)
			.first();
		return { attachment: (result as Attachment | null) ?? null, error: undefined };
	} catch (e: unknown) {
		return { attachment: null, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function getAttachmentKeysByEmailId(db: D1Database, emailId: string) {
	try {
		const { results } = await db
			.prepare("SELECT r2_key FROM attachments WHERE email_id = ?")
			.bind(emailId)
			.all<{ r2_key: string }>();
		return { keys: results.map((row) => row.r2_key), error: undefined };
	} catch (e: unknown) {
		return { keys: [], error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function deleteEmailById(db: D1Database, id: string) {
	try {
		await db.prepare("DELETE FROM attachments WHERE email_id = ?").bind(id).run();
		const { meta } = await db.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
		return { deleted: (meta?.changes ?? 0) > 0, error: undefined };
	} catch (e: unknown) {
		return { deleted: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

// Returns the R2 keys of everything purged so the caller can clean the bucket.
export async function purgeDeletedEmails(db: D1Database, deletedBefore: number) {
	try {
		const { results: rows } = await db
			.prepare("SELECT id FROM emails WHERE deleted_at IS NOT NULL AND deleted_at < ?")
			.bind(deletedBefore)
			.all<{ id: string }>();

		if (rows.length === 0) return { purged: 0, r2Keys: [], error: undefined };

		const ids = rows.map((row) => row.id);
		const placeholders = ids.map(() => "?").join(", ");

		const { results: keyRows } = await db
			.prepare(`SELECT r2_key FROM attachments WHERE email_id IN (${placeholders})`)
			.bind(...ids)
			.all<{ r2_key: string }>();

		await db
			.prepare(`DELETE FROM attachments WHERE email_id IN (${placeholders})`)
			.bind(...ids)
			.run();
		await db
			.prepare(`DELETE FROM emails WHERE id IN (${placeholders})`)
			.bind(...ids)
			.run();

		return { purged: ids.length, r2Keys: keyRows.map((row) => row.r2_key), error: undefined };
	} catch (e: unknown) {
		return { purged: 0, r2Keys: [], error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function upsertDevice(db: D1Database, device: Device) {
	try {
		const { success, error } = await db
			.prepare(
				`INSERT INTO devices (token, platform, environment, created_at, last_seen_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(token) DO UPDATE SET
				   platform = excluded.platform,
				   environment = excluded.environment,
				   last_seen_at = excluded.last_seen_at`,
			)
			.bind(
				device.token,
				device.platform,
				device.environment,
				device.created_at,
				device.last_seen_at,
			)
			.run();
		return { success, error };
	} catch (e: unknown) {
		return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function deleteDevice(db: D1Database, token: string) {
	try {
		const { meta } = await db.prepare("DELETE FROM devices WHERE token = ?").bind(token).run();
		return { deleted: (meta?.changes ?? 0) > 0, error: undefined };
	} catch (e: unknown) {
		return { deleted: false, error: e instanceof Error ? e : new Error(String(e)) };
	}
}

export async function getDevices(db: D1Database) {
	try {
		const { results } = await db.prepare("SELECT * FROM devices").all<Device>();
		return { devices: results, error: undefined };
	} catch (e: unknown) {
		return { devices: [] as Device[], error: e instanceof Error ? e : new Error(String(e)) };
	}
}
