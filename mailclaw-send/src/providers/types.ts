import type { ResolvedSendEmailRequest, SendEmailResponse } from "@/types";

export interface EmailProvider {
	readonly name: string;
	send(request: ResolvedSendEmailRequest): Promise<SendEmailResponse>;
}
