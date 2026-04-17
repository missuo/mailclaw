export interface SendEmailRequest {
	from?: string;
	to: string | string[];
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	reply_to?: string | string[];
	headers?: Record<string, string>;
	tags?: { name: string; value: string }[];
	scheduled_at?: string;
}

export interface ResolvedSendEmailRequest extends SendEmailRequest {
	from: string;
}

export interface SendEmailResponse {
	id: string;
	provider: string;
}
