import { Hono } from "hono";
import * as db from "@/database/d1";
import { now } from "@/utils/helpers";
import { ERR, OK } from "@/utils/http";

const devices = new Hono<{ Bindings: CloudflareBindings }>();

interface RegisterDeviceRequest {
	token?: string;
	platform?: string;
	environment?: string;
}

// Register (or refresh) an APNs device token
devices.post("/api/devices", async (c) => {
	let body: RegisterDeviceRequest;
	try {
		body = await c.req.json<RegisterDeviceRequest>();
	} catch {
		return c.json(ERR("INVALID_BODY", "Request body must be valid JSON"), 400);
	}

	if (!body.token || typeof body.token !== "string") {
		return c.json(ERR("MISSING_FIELDS", "token is required"), 400);
	}

	const environment = body.environment === "sandbox" ? "sandbox" : "production";
	const timestamp = now();

	const { success, error } = await db.upsertDevice(c.env.D1, {
		token: body.token,
		platform: body.platform || "ios",
		environment,
		created_at: timestamp,
		last_seen_at: timestamp,
	});

	if (!success) return c.json(ERR("D1_ERROR", error?.message ?? "Failed to save device"), 500);
	return c.json(OK({ token: body.token, environment }));
});

// Unregister a device token
devices.delete("/api/devices/:token", async (c) => {
	const { deleted, error } = await db.deleteDevice(c.env.D1, c.req.param("token"));
	if (error) return c.json(ERR("D1_ERROR", error.message), 500);
	if (!deleted) return c.json(ERR("NOT_FOUND", "Device not found"), 404);
	return c.json(OK({ message: "Device removed" }));
});

export default devices;
