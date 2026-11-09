import type { SendEmailRequest, SendEmailResponse } from "@/types";
import { base64ToUint8Array, parseNameAddr } from "@/utils/helpers";
import type { EmailProvider } from "./types";

export class CloudflareProvider implements EmailProvider {
	readonly name = "cloudflare";
	private binding: SendEmail;

	constructor(binding: SendEmail) {
		this.binding = binding;
	}

	async send(request: SendEmailRequest): Promise<SendEmailResponse> {
		const from = parseNameAddr(request.from);

		const attachments: EmailAttachment[] | undefined = request.attachments?.map((attachment) =>
			attachment.disposition === "inline"
				? {
						disposition: "inline",
						contentId: attachment.content_id ?? attachment.filename,
						filename: attachment.filename,
						type: attachment.type,
						content: base64ToUint8Array(attachment.content),
					}
				: {
						disposition: "attachment",
						filename: attachment.filename,
						type: attachment.type,
						content: base64ToUint8Array(attachment.content),
					},
		);

		const result = await this.binding.send({
			from: from.name ? { name: from.name, email: from.email } : from.email,
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
			...(attachments && attachments.length > 0 ? { attachments } : {}),
		});

		return { id: result.messageId, provider: this.name };
	}
}
