// Thin wrapper over the Workers AI binding. No API keys: usage is billed to
// the Cloudflare account that owns the Worker.
//
// Models can be overridden with plain vars (not secrets) when Cloudflare
// retires one — see wrangler.jsonc `vars`.

// Fast + cheap: per-email analysis (summary + OTP) gates the push, so latency
// matters more than eloquence here.
const DEFAULT_ANALYSIS_MODEL = "@cf/google/gemma-4-26b-a4b-it";
// Translation is not latency-critical but must follow the target language.
const DEFAULT_TRANSLATION_MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
// User-initiated drafting.
const DEFAULT_COMPOSE_MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";

export type AITask = "analysis" | "translation" | "compose";

export function aiEnabled(env: CloudflareBindings): boolean {
	return Boolean(env.AI);
}

export function modelFor(env: CloudflareBindings, task: AITask): string {
	switch (task) {
		case "analysis":
			return env.AI_ANALYSIS_MODEL || DEFAULT_ANALYSIS_MODEL;
		case "translation":
			return env.AI_TRANSLATION_MODEL || DEFAULT_TRANSLATION_MODEL;
		case "compose":
			return env.AI_COMPOSE_MODEL || DEFAULT_COMPOSE_MODEL;
	}
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface ChatCompletion {
	choices?: { message?: { content?: string | Record<string, unknown> | null } }[];
	// Older Workers AI models answer in this shape instead.
	response?: string | Record<string, unknown>;
}

// Thinking is switched off everywhere: these are short, well-specified tasks
// and reasoning tokens only add latency and cost.
const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

function contentOf(result: ChatCompletion): string | Record<string, unknown> | null {
	return result.choices?.[0]?.message?.content ?? result.response ?? null;
}

async function run(
	env: CloudflareBindings,
	model: string,
	inputs: Record<string, unknown>,
): Promise<ChatCompletion> {
	// The binding's model union type lags the catalog; models are plain strings here.
	const ai = env.AI as unknown as {
		run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
	};
	return (await ai.run(model, { ...NO_THINKING, ...inputs })) as ChatCompletion;
}

// Structured output: the model is constrained to `schema` and the parsed
// object is returned.
export async function completeJSON<T>(
	env: CloudflareBindings,
	task: AITask,
	messages: ChatMessage[],
	schema: Record<string, unknown>,
	maxTokens: number,
): Promise<T> {
	const result = await run(env, modelFor(env, task), {
		messages,
		max_tokens: maxTokens,
		temperature: 0,
		response_format: {
			type: "json_schema",
			json_schema: { name: "result", schema, strict: true },
		},
	});

	const content = contentOf(result);
	if (content && typeof content === "object") return content as T;
	if (typeof content === "string" && content.trim()) return JSON.parse(content) as T;
	throw new Error("Workers AI returned no content");
}

// Plain-text completion.
export async function completeText(
	env: CloudflareBindings,
	task: AITask,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<string> {
	const result = await run(env, modelFor(env, task), { messages, max_tokens: maxTokens });
	const content = contentOf(result);
	return typeof content === "string" ? content.trim() : "";
}

// Streaming completion, re-emitted as a minimal SSE stream:
//   data: {"delta":"..."}\n\n   …   data: [DONE]\n\n
// so clients never depend on the upstream model's chunk format.
export async function streamText(
	env: CloudflareBindings,
	task: AITask,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<ReadableStream<Uint8Array>> {
	const upstream = (await run(env, modelFor(env, task), {
		messages,
		max_tokens: maxTokens,
		stream: true,
	})) as unknown as ReadableStream<Uint8Array>;

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let buffer = "";

	const emit = (controller: TransformStreamDefaultController<Uint8Array>, line: string) => {
		if (!line.startsWith("data:")) return;
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") return;
		try {
			const chunk = JSON.parse(data) as {
				choices?: { delta?: { content?: string | null } }[];
				response?: string;
			};
			const delta = chunk.choices?.[0]?.delta?.content ?? chunk.response ?? "";
			if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
		} catch {
			// Ignore keep-alives and partial frames.
		}
	};

	return upstream.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				buffer += decoder.decode(chunk, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) emit(controller, line);
			},
			flush(controller) {
				if (buffer) emit(controller, buffer);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			},
		}),
	);
}
