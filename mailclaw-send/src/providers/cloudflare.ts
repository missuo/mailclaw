import type { ResolvedSendEmailRequest, SendEmailResponse } from "@/types";
import type { EmailProvider } from "./types";

export class CloudflareProvider implements EmailProvider {
	readonly name = "cloudflare";
	private binding: SendEmail;

	constructor(binding: SendEmail) {
		this.binding = binding;
	}

	async send(request: ResolvedSendEmailRequest): Promise<SendEmailResponse> {
		const result = await this.binding.send({
			from: request.from,
			to: Array.isArray(request.to) ? request.to : [request.to],
			subject: request.subject,
			...(request.text ? { text: request.text } : {}),
			...(request.html ? { html: request.html } : {}),
			...(request.cc ? { cc: Array.isArray(request.cc) ? request.cc : [request.cc] } : {}),
			...(request.bcc ? { bcc: Array.isArray(request.bcc) ? request.bcc : [request.bcc] } : {}),
			...(request.reply_to
				? { replyTo: Array.isArray(request.reply_to) ? request.reply_to[0] : request.reply_to }
				: {}),
			...(request.headers ? { headers: request.headers } : {}),
		});

		return { id: result.messageId, provider: this.name };
	}
}
