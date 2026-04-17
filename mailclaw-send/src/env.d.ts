// Extend CloudflareBindings with secrets/vars not auto-generated.
// Bindings (SEND_EMAIL) are auto-generated into worker-configuration.d.ts.
interface CloudflareBindings {
	API_TOKEN: string;
	RESEND_API_KEY?: string;
	EMAIL_PROVIDER?: string; // "resend" | "cloudflare" — defaults to "cloudflare"
	DEFAULT_FROM?: string; // optional default sender when request omits `from`
}
