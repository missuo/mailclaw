import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth";
import healthRoutes from "@/routes/health";
import sendRoutes from "@/routes/send";
import { ERR } from "@/utils/http";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Health check (no auth)
app.route("/", healthRoutes);

// Auth for send endpoint
app.use("/api/emails/send", authMiddleware);

// Send route
app.route("/", sendRoutes);

// 404
app.notFound((c) => {
	return c.json(ERR("NOT_FOUND", "Route not found"), 404);
});

// Error handler
app.onError((err, c) => {
	console.error(`Unhandled error: ${err.message}`, err);
	return c.json(ERR("INTERNAL_ERROR", err.message), 500);
});

export default app;
