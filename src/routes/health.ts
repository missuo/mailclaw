import { Hono } from "hono";
import { OK } from "@/utils/http";
import { getCapabilities, SERVER_VERSION } from "@/version";

const health = new Hono<{ Bindings: CloudflareBindings }>();

health.get("/api/health", (c) => {
	return c.json(
		OK({
			status: "ok",
			timestamp: Date.now(),
			version: SERVER_VERSION,
			capabilities: getCapabilities(c.env),
		}),
	);
});

export default health;
