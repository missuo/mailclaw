import { Hono } from "hono";
import { z } from "zod";
import { aiEnabled, completeText, streamText } from "@/ai/workers-ai";
import { ERR, OK } from "@/utils/http";

// Generic completion for client-side AI features (compose, polish, tone,
// subject suggestions…). Clients own the prompts; the server owns the model
// and the bill, so no client ever needs an LLM key.

const completeRequest = z.object({
	system: z.string().max(20000).optional(),
	messages: z
		.array(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string().max(100000),
			}),
		)
		.min(1)
		.max(50),
	stream: z.boolean().optional(),
	max_tokens: z.number().int().min(1).max(8192).optional(),
});

const ai = new Hono<{ Bindings: CloudflareBindings }>();

ai.post("/api/ai/complete", async (c) => {
	if (!aiEnabled(c.env)) {
		return c.json(ERR("AI_NOT_CONFIGURED", "Workers AI binding is not configured"), 501);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json(ERR("INVALID_BODY", "Request body must be valid JSON"), 400);
	}
	const parsed = completeRequest.safeParse(body);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return c.json(ERR("INVALID_BODY", `${issue.path.join(".")}: ${issue.message}`), 400);
	}

	const { system, messages, stream, max_tokens: maxTokens = 4096 } = parsed.data;
	const chat = system ? [{ role: "system" as const, content: system }, ...messages] : messages;

	try {
		if (stream) {
			const body = await streamText(c.env, "compose", chat, maxTokens);
			return new Response(body, {
				headers: {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
				},
			});
		}
		const text = await completeText(c.env, "compose", chat, maxTokens);
		return c.json(OK({ text }));
	} catch (err) {
		const message = err instanceof Error ? err.message : "AI request failed";
		return c.json(ERR("AI_FAILED", message), 502);
	}
});

export default ai;
