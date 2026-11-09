import { z } from "zod";
import { now } from "@/utils/helpers";

// User preferences shared by every client (a new phone inherits them).
// Stored as key/value rows so new keys never need a migration. Credentials
// never live here — API tokens stay on each device.

const filterRule = z.object({
	mode: z.enum(["include", "exclude"]),
	field: z.enum(["from", "to"]),
	// "user@example.com" (exact) or "@example.com" / "example.com" (domain and subdomains).
	pattern: z.string().trim().min(1).max(320),
});

// Client-owned shapes: validated loosely so the app can add fields freely.
const template = z.looseObject({
	name: z.string(),
	to: z.string().optional(),
	subject: z.string().optional(),
	body: z.string().optional(),
});

const identity = z.looseObject({
	display_name: z.string(),
	address: z.string(),
});

const settingsSchema = z.object({
	// AI enrichment
	summary_language: z.string().min(1).max(64),
	translation_language: z.string().min(1).max(64),
	primary_language: z.string().min(1).max(64),
	auto_summarize: z.boolean(),
	auto_translate: z.boolean(),
	otp_detection: z.boolean(),
	// Reader / composer
	show_translation: z.boolean(),
	signature: z.string().max(10000),
	compose_rules: z.string().max(10000),
	templates: z.array(template).max(200),
	identities: z.array(identity).max(100),
	default_identity: z.string().max(320),
	// App-only Include/Exclude rules (see utils/filter-rules.ts)
	filter_rules: z.array(filterRule).max(500),
});

export type Settings = z.infer<typeof settingsSchema>;
export type FilterRule = z.infer<typeof filterRule>;

export const DEFAULT_SETTINGS: Settings = {
	summary_language: "English",
	translation_language: "English",
	primary_language: "English",
	auto_summarize: true,
	auto_translate: false,
	otp_detection: true,
	show_translation: true,
	signature: "",
	compose_rules: "",
	templates: [],
	identities: [],
	default_identity: "",
	filter_rules: [],
};

type Kind = "string" | "boolean" | "json";

function kindOf(key: keyof Settings): Kind {
	const value = DEFAULT_SETTINGS[key];
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string") return "string";
	return "json";
}

function decode(key: keyof Settings, raw: string): unknown {
	switch (kindOf(key)) {
		case "boolean":
			return raw === "true";
		case "string":
			return raw;
		case "json":
			try {
				return JSON.parse(raw);
			} catch {
				return undefined;
			}
	}
}

function encode(key: keyof Settings, value: unknown): string {
	return kindOf(key) === "json" ? JSON.stringify(value) : String(value);
}

export async function getSettings(db: D1Database): Promise<Settings> {
	try {
		const { results } = await db
			.prepare("SELECT key, value FROM settings")
			.all<{ key: string; value: string }>();

		const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
		for (const row of results) {
			if (!(row.key in DEFAULT_SETTINGS)) continue;
			const key = row.key as keyof Settings;
			// A corrupt row falls back to the default instead of breaking ingest.
			const parsed = settingsSchema.shape[key].safeParse(decode(key, row.value));
			if (parsed.success) settings[key] = parsed.data;
		}
		return settings as Settings;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export type SettingsPatchResult =
	| { ok: true; patch: Partial<Settings> }
	| { ok: false; message: string };

// Validates a partial update. Unknown keys are dropped (newer clients may
// send keys this server does not know yet); known keys must be valid.
export function parseSettingsPatch(body: unknown): SettingsPatchResult {
	const parsed = settingsSchema.partial().safeParse(body);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false, message: `${issue.path.join(".") || "body"}: ${issue.message}` };
	}
	return { ok: true, patch: parsed.data };
}

// Applies a validated partial update in one batch.
export async function putSettings(
	db: D1Database,
	patch: Partial<Settings>,
): Promise<{ settings: Settings; error?: Error }> {
	const timestamp = now();
	try {
		const statements = Object.entries(patch)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) =>
				db
					.prepare(
						`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
						 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
					)
					.bind(key, encode(key as keyof Settings, value), timestamp),
			);
		if (statements.length > 0) await db.batch(statements);
		return { settings: await getSettings(db) };
	} catch (e: unknown) {
		return {
			settings: await getSettings(db),
			error: e instanceof Error ? e : new Error(String(e)),
		};
	}
}
