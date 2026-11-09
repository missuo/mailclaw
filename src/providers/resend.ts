import type { SendEmailRequest, SendEmailResponse } from "@/types";
import type { EmailProvider } from "./types";

const RESEND_API_URL = "https://api.resend.com/emails";

export class ResendProvider implements EmailProvider {
	readonly name = "resend";
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	async send(request: SendEmailRequest): Promise<SendEmailResponse> {
		const body: Record<string, unknown> = {
			from: request.from,
			to: Array.isArray(request.to) ? request.to : [request.to],
			subject: request.subject,
		};

		if (request.html) body.html = request.html;
		if (request.text) body.text = request.text;
		if (request.cc) body.cc = Array.isArray(request.cc) ? request.cc : [request.cc];
		if (request.bcc) body.bcc = Array.isArray(request.bcc) ? request.bcc : [request.bcc];
		if (request.reply_to) {
			body.reply_to = Array.isArray(request.reply_to) ? request.reply_to : [request.reply_to];
		}
		if (request.headers) body.headers = request.headers;
		if (request.attachments && request.attachments.length > 0) {
			// Resend takes base64 content directly, so pass it through.
			body.attachments = request.attachments.map((attachment) => ({
				filename: attachment.filename,
				content: attachment.content,
				content_type: attachment.type,
				...(attachment.content_id ? { content_id: attachment.content_id } : {}),
			}));
		}
		if (request.tags) body.tags = request.tags;
		if (request.scheduled_at) body.scheduled_at = request.scheduled_at;

		const response = await fetch(RESEND_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const error = (await response.json().catch(() => null)) as {
				message?: string;
				name?: string;
			} | null;
			const message = error?.message || `Resend API error: ${response.status}`;
			throw new Error(message);
		}

		const data = (await response.json()) as { id: string };
		return { id: data.id, provider: this.name };
	}
}
