// Extend CloudflareBindings with secrets not in wrangler.jsonc.
// Bindings (D1, SEND_EMAIL, ATTACHMENTS) are auto-generated into
// worker-configuration.d.ts; ATTACHMENTS is declared here too so type
// checking passes before `bun run cf-typegen` is run after adding the binding.
interface CloudflareBindings {
	API_TOKEN: string;
	RESEND_API_KEY?: string;
	EMAIL_PROVIDER?: string; // "resend" | "cloudflare" — defaults to "resend"
	ATTACHMENTS: R2Bucket;
	// APNs push secrets — push is disabled until all four are set.
	APNS_KEY?: string; // contents of the .p8 AuthKey (PEM)
	APNS_KEY_ID?: string;
	APNS_TEAM_ID?: string;
	APNS_TOPIC?: string; // the app's bundle id
	// Workers AI (wrangler.jsonc `ai` binding). AI features are off without it.
	AI: Ai;
	// Optional model overrides (plain vars) for when Cloudflare retires a model.
	AI_ANALYSIS_MODEL?: string;
	AI_TRANSLATION_MODEL?: string;
	AI_COMPOSE_MODEL?: string;
}
