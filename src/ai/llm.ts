// Minimal server-side LLM client. Speaks the same three protocols the app
// supports, but non-streaming — enrichment only needs the final text.

export type LLMProtocol = "chat" | "responses" | "messages";

export interface LLMConfig {
	baseURL: string;
	apiKey: string;
	protocol: LLMProtocol;
	model: string;
}

export function getLLMConfig(env: CloudflareBindings): LLMConfig | null {
	if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !env.LLM_MODEL) return null;
	const protocol = (env.LLM_PROTOCOL || "chat").toLowerCase();
	return {
		baseURL: env.LLM_BASE_URL.replace(/\/+$/, ""),
		apiKey: env.LLM_API_KEY,
		protocol: (["chat", "responses", "messages"].includes(protocol)
			? protocol
			: "chat") as LLMProtocol,
		model: env.LLM_MODEL,
	};
}

// Providers are configured with a bare host or a base ending in /v1;
// normalize so both work.
function endpoint(baseURL: string, path: string): string {
	const base = baseURL.endsWith("/v1") ? baseURL : `${baseURL}/v1`;
	return `${base}/${path}`;
}

export async function complete(
	config: LLMConfig,
	system: string,
	user: string,
	maxTokens = 8192,
): Promise<string> {
	const { url, body, headers } = buildRequest(config, system, user, maxTokens);

	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`LLM ${response.status}: ${detail.slice(0, 300)}`);
	}

	return extractText(config.protocol, await response.json());
}

function buildRequest(
	config: LLMConfig,
	system: string,
	user: string,
	maxTokens: number,
): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
	switch (config.protocol) {
		case "messages":
			return {
				url: endpoint(config.baseURL, "messages"),
				headers: {
					"x-api-key": config.apiKey,
					"anthropic-version": "2023-06-01",
					// Many proxies expect a bearer token instead; send both.
					authorization: `Bearer ${config.apiKey}`,
				},
				body: {
					model: config.model,
					max_tokens: maxTokens,
					system,
					messages: [{ role: "user", content: user }],
				},
			};
		case "responses":
			return {
				url: endpoint(config.baseURL, "responses"),
				headers: { authorization: `Bearer ${config.apiKey}` },
				body: {
					model: config.model,
					max_output_tokens: maxTokens,
					instructions: system,
					input: [{ role: "user", content: user }],
				},
			};
		default:
			return {
				url: endpoint(config.baseURL, "chat/completions"),
				headers: { authorization: `Bearer ${config.apiKey}` },
				body: {
					model: config.model,
					max_tokens: maxTokens,
					messages: [
						{ role: "system", content: system },
						{ role: "user", content: user },
					],
				},
			};
	}
}

// Each protocol nests the answer differently; reasoning parts are skipped.
function extractText(protocol: LLMProtocol, payload: unknown): string {
	const data = payload as Record<string, any>;

	if (protocol === "messages") {
		const blocks = (data.content ?? []) as { type?: string; text?: string }[];
		return blocks
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("")
			.trim();
	}

	if (protocol === "responses") {
		if (typeof data.output_text === "string") return data.output_text.trim();
		const output = (data.output ?? []) as {
			type?: string;
			content?: { type?: string; text?: string }[];
		}[];
		return output
			.filter((item) => item.type === "message")
			.flatMap((item) => item.content ?? [])
			.filter((part) => part.type === "output_text")
			.map((part) => part.text ?? "")
			.join("")
			.trim();
	}

	return (data.choices?.[0]?.message?.content ?? "").trim();
}
