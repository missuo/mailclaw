import { Hono } from "hono";
import { getSettings, parseSettingsPatch, putSettings } from "@/database/settings";
import { ERR, OK } from "@/utils/http";

const settings = new Hono<{ Bindings: CloudflareBindings }>();

// Read all synced preferences (languages, AI toggles, signature, templates,
// identities, filter rules…)
settings.get("/api/settings", async (c) => {
	return c.json(OK(await getSettings(c.env.D1)));
});

// Update a subset of preferences; returns the full merged settings
settings.put("/api/settings", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json(ERR("INVALID_BODY", "Request body must be valid JSON"), 400);
	}

	const parsed = parseSettingsPatch(body);
	if (!parsed.ok) return c.json(ERR("INVALID_SETTINGS", parsed.message), 400);

	const { settings: updated, error } = await putSettings(c.env.D1, parsed.patch);
	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	return c.json(OK(updated));
});

export default settings;
