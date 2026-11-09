import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth";
import deviceRoutes from "@/routes/devices";
import emailRoutes from "@/routes/emails";
import healthRoutes from "@/routes/health";
import settingsRoutes from "@/routes/settings";
import { ERR } from "@/utils/http";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Health check (no auth)
app.route("/", healthRoutes);

// Auth middleware for all /api/emails and /api/devices routes
app.use("/api/emails/*", authMiddleware);
app.use("/api/emails", authMiddleware);
app.use("/api/devices/*", authMiddleware);
app.use("/api/devices", authMiddleware);
app.use("/api/settings", authMiddleware);

// Email routes
app.route("/", emailRoutes);

// Device (push token) routes
app.route("/", deviceRoutes);

// User preference routes
app.route("/", settingsRoutes);

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
