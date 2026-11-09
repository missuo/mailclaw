import { getLLMConfig } from "@/ai/llm";

// Server version + capability list, exposed on /api/health so clients can
// negotiate features. Bump the version on every release; capabilities are
// additive within a major version (see API.md).
export const SERVER_VERSION = "2.1.0";

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
	];
	if (env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC) {
		capabilities.push("push");
	}
	// Summaries and translations are generated at ingest and served from D1.
	if (getLLMConfig(env)) {
		capabilities.push("server-ai");
	}
	return capabilities;
}
