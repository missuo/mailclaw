import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth";
import aiRoutes from "@/routes/ai";
import deviceRoutes from "@/routes/devices";
import emailRoutes from "@/routes/emails";
import healthRoutes from "@/routes/health";
import settingsRoutes from "@/routes/settings";
import { ERR } from "@/utils/http";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Health check (no auth)
app.route("/", healthRoutes);

// Auth middleware for every route except health
app.use("/api/emails/*", authMiddleware);
app.use("/api/emails", authMiddleware);
app.use("/api/devices/*", authMiddleware);
app.use("/api/devices", authMiddleware);
app.use("/api/settings", authMiddleware);
app.use("/api/ai/*", authMiddleware);

// Email routes
app.route("/", emailRoutes);

// Device (push token) routes
app.route("/", deviceRoutes);

// User preference routes
app.route("/", settingsRoutes);

// AI completion for client features (compose etc.)
app.route("/", aiRoutes);

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
