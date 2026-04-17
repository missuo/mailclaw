import { Hono } from "hono";
import { OK } from "@/utils/http";

const health = new Hono<{ Bindings: CloudflareBindings }>();

health.get("/api/health", (c) => {
	return c.json(OK({ status: "ok", timestamp: Date.now() }));
});

export default health;
