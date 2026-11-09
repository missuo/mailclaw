import { now } from "@/utils/helpers";

// User preferences that drive server-side enrichment. Stored as key/value
// rows so new keys never need a migration.
export interface Settings {
	summary_language: string;
	translation_language: string;
	primary_language: string;
	auto_summarize: boolean;
	auto_translate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	summary_language: "English",
	translation_language: "English",
	primary_language: "English",
	auto_summarize: true,
	auto_translate: false,
};

const BOOLEAN_KEYS = new Set(["auto_summarize", "auto_translate"]);

export async function getSettings(db: D1Database): Promise<Settings> {
	try {
		const { results } = await db
			.prepare("SELECT key, value FROM settings")
			.all<{ key: string; value: string }>();

		const settings: Settings = { ...DEFAULT_SETTINGS };
		for (const row of results) {
			if (!(row.key in DEFAULT_SETTINGS)) continue;
			const key = row.key as keyof Settings;
			if (BOOLEAN_KEYS.has(row.key)) {
				(settings[key] as boolean) = row.value === "true";
			} else {
				(settings[key] as string) = row.value;
			}
		}
		return settings;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

// Applies a partial update; unknown keys are ignored.
export async function putSettings(
	db: D1Database,
	patch: Partial<Settings>,
): Promise<{ settings: Settings; error?: Error }> {
	const timestamp = now();
	try {
		for (const [key, value] of Object.entries(patch)) {
			if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
			await db
				.prepare(
					`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
					 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
				)
				.bind(key, String(value), timestamp)
				.run();
		}
		return { settings: await getSettings(db) };
	} catch (e: unknown) {
		return {
			settings: await getSettings(db),
			error: e instanceof Error ? e : new Error(String(e)),
		};
	}
}
