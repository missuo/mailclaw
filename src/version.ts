import { aiEnabled } from "@/ai/workers-ai";

// Server version + capability list, exposed on /api/health so clients can
// negotiate features. Bump the version on every release; capabilities are
// additive within a major version (see API.md).
export const SERVER_VERSION = "2.2.0";

export function getCapabilities(env: CloudflareBindings): string[] {
	const capabilities = [
		"read-state",
		"threads",
		"sent-storage",
		"soft-delete",
		"delta-sync",
		"send-attachments",
		"devices",
		"settings",
		// App-only Include/Exclude rules stored in settings.filter_rules.
		"filter-rules",
	];
	if (env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC) {
		capabilities.push("push");
	}
	if (aiEnabled(env)) {
		// Summaries, translations and OTPs are generated at ingest by Workers AI;
		// /api/ai/complete serves client-side AI features.
		capabilities.push("server-ai", "otp", "server-compose");
	}
	return capabilities;
}
