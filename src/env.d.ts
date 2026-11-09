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
	// Server-side AI enrichment (summary + translation at ingest).
	// Enrichment is skipped unless BASE_URL, API_KEY and MODEL are all set.
	LLM_BASE_URL?: string;
	LLM_API_KEY?: string;
	LLM_MODEL?: string;
	LLM_PROTOCOL?: string; // "chat" | "responses" | "messages" — defaults to "chat"
}
