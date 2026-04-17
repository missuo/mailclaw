import { CloudflareProvider } from "./cloudflare";
import { ResendProvider } from "./resend";
import type { EmailProvider } from "./types";

export function createEmailProvider(env: CloudflareBindings): EmailProvider {
	const provider = (env.EMAIL_PROVIDER || "cloudflare").toLowerCase();

	switch (provider) {
		case "resend": {
			if (!env.RESEND_API_KEY) {
				throw new Error("RESEND_API_KEY is required when using the Resend provider");
			}
			return new ResendProvider(env.RESEND_API_KEY);
		}
		case "cloudflare": {
			if (!env.SEND_EMAIL) {
				throw new Error(
					"SEND_EMAIL binding is required when using the Cloudflare provider (configure send_email in wrangler.jsonc)",
				);
			}
			return new CloudflareProvider(env.SEND_EMAIL);
		}
		default:
			throw new Error(`Unknown email provider: ${provider}`);
	}
}
