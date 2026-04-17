import { Hono } from "hono";
import { createEmailProvider } from "@/providers";
import type { ResolvedSendEmailRequest, SendEmailRequest } from "@/types";
import { ERR, OK } from "@/utils/http";

const send = new Hono<{ Bindings: CloudflareBindings }>();

send.post("/api/emails/send", async (c) => {
	let body: SendEmailRequest;
	try {
		body = await c.req.json<SendEmailRequest>();
	} catch {
		return c.json(ERR("INVALID_BODY", "Request body must be valid JSON"), 400);
	}

	const from = body.from ?? c.env.DEFAULT_FROM;
	if (!from) {
		return c.json(
			ERR("MISSING_FROM", "`from` is required (or set DEFAULT_FROM in worker vars)"),
			400,
		);
	}

	if (!body.to || !body.subject) {
		return c.json(ERR("MISSING_FIELDS", "to and subject are required"), 400);
	}

	if (!body.html && !body.text) {
		return c.json(ERR("MISSING_CONTENT", "Either html or text content is required"), 400);
	}

	const resolved: ResolvedSendEmailRequest = { ...body, from };

	try {
		const provider = createEmailProvider(c.env);
		const result = await provider.send(resolved);
		return c.json(OK(result));
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to send email";
		return c.json(ERR("SEND_FAILED", message), 500);
	}
});

export default send;
