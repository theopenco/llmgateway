// `/v1/messages` speaks Anthropic's Messages API, but the two request formats
// overlap enough (`model` + `messages`) that an OpenAI Chat Completions body
// reaches this endpoint by accident. When the body is structurally OpenAI the
// schema rejects it anyway, but with a union error ("tools.0: Invalid input")
// that says nothing about the real problem — so the caller retries the same
// request instead of moving to `/v1/chat/completions`.
//
// This detects the OpenAI shape purely to *explain* an existing rejection. It
// deliberately does NOT decide whether to reject:
//
// Only structural markers are matched — shapes the Anthropic schema already
// fails on. OpenAI-only *parameters* (`response_format`, `stop`, `n`,
// `stream_options`, `max_completion_tokens`, a string `tool_choice`, …) are
// NOT matched, even though they are equally strong evidence of an OpenAI
// client. The schema strips unknown keys, so a body carrying them is accepted
// today; matching them would turn requests that currently succeed into 400s.
// A caller sending a fundamentally sound Anthropic request with one stray
// OpenAI-ish field must keep working, and that outweighs diagnosing the
// misdirected-client case more thoroughly.

// Content-part discriminators from OpenAI's Chat Completions and Responses
// APIs. Anthropic uses `image`/`document`/`text` instead, so the content-block
// union rejects all of these.
const OPENAI_ONLY_CONTENT_PART_TYPES = new Set([
	"file",
	"image_url",
	"input_audio",
	"input_image",
	"input_text",
	"output_text",
	"refusal",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the OpenAI-only structural markers found in a raw `/v1/messages`
 * body, as human-readable labels (e.g. `tools[0].function`). Empty when the
 * body carries no such marker.
 *
 * Every marker it reports is a shape the Anthropic request schema rejects on
 * its own, so a non-empty result never changes whether a request is accepted —
 * only how the rejection is explained. Callers must treat it as diagnostic and
 * never as a rejection trigger.
 */
export function detectOpenAiChatCompletionsFields(raw: unknown): string[] {
	if (!isRecord(raw)) {
		return [];
	}

	const found: string[] = [];

	// OpenAI wraps tool definitions in a `function` object; Anthropic puts
	// `name`/`input_schema` at the top level of the tool, so the tool union
	// fails on this.
	if (Array.isArray(raw.tools)) {
		raw.tools.forEach((tool, index) => {
			if (
				isRecord(tool) &&
				tool.type === "function" &&
				isRecord(tool.function)
			) {
				found.push(`tools[${index}].function`);
			}
		});
	}

	if (Array.isArray(raw.messages)) {
		raw.messages.forEach((message, index) => {
			if (!isRecord(message)) {
				return;
			}
			if (
				typeof message.role === "string" &&
				["developer", "tool", "function"].includes(message.role)
			) {
				found.push(`messages[${index}].role "${message.role}"`);
			}
			// OpenAI assistant turns that only call tools carry `content: null`;
			// Anthropic requires a string or a content-block array.
			if (message.content === null) {
				found.push(`messages[${index}].content (null)`);
				return;
			}
			if (!Array.isArray(message.content)) {
				return;
			}
			for (const part of message.content) {
				if (
					isRecord(part) &&
					typeof part.type === "string" &&
					OPENAI_ONLY_CONTENT_PART_TYPES.has(part.type)
				) {
					found.push(`messages[${index}].content[].type "${part.type}"`);
					break;
				}
			}
		});
	}

	return found;
}

/**
 * The message used for an already-failing request whose body is recognisably
 * OpenAI Chat Completions, in place of the raw schema error.
 */
export function buildOpenAiRequestRejectionMessage(fields: string[]): string {
	return (
		`This endpoint implements Anthropic's Messages API, and the request body uses OpenAI Chat Completions structures (${fields.join(", ")}) that Anthropic's format has no equivalent for. ` +
		`Send OpenAI-format requests to /v1/chat/completions instead, or convert the body to Anthropic's Messages format.`
	);
}
