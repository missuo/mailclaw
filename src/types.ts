export type EmailDirection = "inbound" | "outbound";

export interface Email {
	id: string;
	from_address: string;
	to_address: string;
	subject: string | null;
	received_at: number;
	html_content: string | null;
	text_content: string | null;
	has_attachments: boolean;
	attachment_count: number;
	direction: EmailDirection;
	message_id: string | null;
	in_reply_to: string | null;
	references_header: string | null;
	read: boolean;
	starred: boolean;
	archived: boolean;
	deleted_at: number | null;
	updated_at: number;
	// AI enrichment generated server-side at ingest (null until it lands).
	summary: string | null;
	summary_lang: string | null;
	translation: string | null;
	translation_lang: string | null;
	// Populated only on the single-email detail endpoint.
	attachments?: AttachmentSummary[];
}

export type EmailSummary = Omit<Email, "html_content" | "text_content">;

export interface Attachment {
	id: string;
	email_id: string;
	filename: string | null;
	mime_type: string | null;
	size: number;
	r2_key: string;
	created_at: number;
}

// Attachment metadata as exposed via the API (R2 key is internal).
export type AttachmentSummary = Omit<Attachment, "r2_key">;

export type Mailbox = "inbox" | "sent" | "archive" | "trash" | "starred" | "all";

export interface EmailFilters {
	from?: string;
	to?: string;
	q?: string;
	after?: number;
	before?: number;
	mailbox?: Mailbox;
	updated_after?: number;
	limit: number;
	offset: number;
}

export interface PaginatedResponse<T> {
	emails: T[];
	total: number;
	limit: number;
	offset: number;
}

// Mutable client-facing flags for PATCH /api/emails/:id.
export interface EmailPatch {
	read?: boolean;
	starred?: boolean;
	archived?: boolean;
	// false restores a soft-deleted email from Trash, true moves it there.
	deleted?: boolean;
}

export interface SendAttachment {
	filename: string;
	type: string;
	// Base64-encoded bytes.
	content: string;
	disposition?: "attachment" | "inline";
	content_id?: string;
}

export interface SendEmailRequest {
	from: string;
	to: string | string[];
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	reply_to?: string | string[];
	headers?: Record<string, string>;
	attachments?: SendAttachment[];
	tags?: { name: string; value: string }[];
	scheduled_at?: string;
}

export interface SendEmailResponse {
	id: string;
	provider: string;
	// D1 row id of the persisted outbound copy (absent if persistence failed).
	email_id?: string;
}

export interface Device {
	token: string;
	platform: string;
	environment: string;
	created_at: number;
	last_seen_at: number;
}
