import type { Context, Next } from "hono";
import { ERR } from "@/utils/http";

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	const len = bBytes.length;
	let result = aBytes.length ^ bBytes.length;
	for (let i = 0; i < len; i++) {
		result |= (aBytes[i] ?? 0) ^ bBytes[i];
	}
	return result === 0;
}

export async function authMiddleware(c: Context<{ Bindings: CloudflareBindings }>, next: Next) {
	const authHeader = c.req.header("Authorization");

	if (!authHeader?.startsWith("Bearer ")) {
		return c.json(ERR("UNAUTHORIZED", "Missing or invalid Authorization header"), 401);
	}

	const token = authHeader.slice(7);

	if (!timingSafeEqual(token, c.env.API_TOKEN)) {
		return c.json(ERR("UNAUTHORIZED", "Invalid API token"), 401);
	}

	await next();
}
