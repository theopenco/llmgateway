import {
	type BaseMessage,
	type OpenAIRequestBody,
	type OpenAIResponsesRequestBody,
	type OpenAIToolInput,
	type ProviderId,
	type ProviderRequestBody,
	type ReasoningEffort,
	type ToolChoiceMode,
	type ToolChoiceType,
	type WebSearchTool,
	providers,
} from "@llmgateway/models";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import { getGcpServiceAccountAccessToken } from "./gcp-access-token.js";
import { getProviderEndpoint } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { prepareRequestBody } from "./prepare-request-body.js";
import {
	getProviderApiTransport,
	getUpstreamModelId,
} from "./provider-api-format.js";
import {
	decryptProviderKey,
	encryptProviderKey,
} from "./provider-key/crypto.js";
import { redactToken } from "./provider-key/redact.js";

import type {
	ProviderKeyOptions,
	ProviderModelVerificationCheck,
	ProviderModelVerificationProbe,
	ProviderModelVerificationTarget,
} from "@llmgateway/db";

export type ModelVerificationCheckId =
	| "basic"
	| "streaming"
	| "vision"
	| "audio"
	| "tools"
	| "json_output"
	| "structured_json"
	| "reasoning"
	| "reasoning_budget"
	| "web_search"
	| "context_size"
	| "max_output";

export interface ModelVerificationRequest {
	model: string;
	messages: BaseMessage[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	response_format?: OpenAIRequestBody["response_format"];
	tools?: OpenAIToolInput[];
	tool_choice?: ToolChoiceType;
	reasoning_effort?: ReasoningEffort;
}

interface ModelVerificationDefinition {
	id: ModelVerificationCheckId;
	label: string;
	request: ModelVerificationRequest;
}

export interface RunModelVerificationOptions {
	target: ProviderModelVerificationTarget;
	token: string;
	baseUrl?: string;
	providerKeyOptions?: ProviderKeyOptions;
	/** Database credentials fully describe their endpoint and must not inherit env. */
	skipEnvVars?: boolean;
	onCheck?: (check: ProviderModelVerificationCheck) => Promise<void> | void;
	fetchImplementation?: typeof fetch;
	/** Overrides BILLING_DATA_CHECKS_REQUIRED for this run. */
	requireBillingData?: boolean;
}

export interface ModelVerificationRunResult {
	passed: boolean;
	checks: ProviderModelVerificationCheck[];
	summary: string;
	/**
	 * `tool_choice` modes the tool check probed and the upstream did not
	 * honour. Present only when a weaker mode then worked, so the listing can
	 * narrow `supportedToolChoices` instead of keeping a mode that returns
	 * unusable responses.
	 */
	unsupportedToolChoices?: ToolChoiceMode[];
	/**
	 * Reasoning effort tiers the reasoning checks probed and the upstream refused.
	 * Present only when another tier then proved the model reasons, so the listing
	 * narrows its declared tiers instead of losing `reasoning` to a tier name the
	 * deployment happens not to accept.
	 */
	unsupportedReasoningEfforts?: ReasoningEffort[];
}

// A 64x64 solid red PNG. Deliberately not a 1x1 pixel: several OpenAI-compatible
// serving stacks reject a degenerate image before the model ever sees it, which
// fails the check on endpoints whose vision support is fine.
const RED_IMAGE_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";

const COUNTRY_SCHEMA = {
	type: "object",
	properties: {
		name: { type: "string" },
		capital: { type: "string" },
		continent: { type: "string" },
	},
	required: ["name", "capital", "continent"],
	additionalProperties: false,
} as const;

export function createBasicVerificationRequest(
	model: string,
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Reply with exactly OK." },
		],
	};
}

export function createStreamingVerificationRequest(
	model: string,
): ModelVerificationRequest {
	return {
		...createBasicVerificationRequest(model),
		stream: true,
	};
}

export function createVisionVerificationRequest(
	model: string,
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "What color is this image?" },
					{
						type: "image_url",
						image_url: { url: RED_IMAGE_DATA_URL },
					},
				],
			},
		],
	};
}

function createToneWavBase64(): string {
	const sampleRate = 8_000;
	const sampleCount = sampleRate / 4;
	const bytesPerSample = 2;
	const dataSize = sampleCount * bytesPerSample;
	const wav = Buffer.alloc(44 + dataSize);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(36 + dataSize, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
	wav.writeUInt16LE(bytesPerSample, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(dataSize, 40);
	for (let sample = 0; sample < sampleCount; sample++) {
		const amplitude = Math.sin((2 * Math.PI * 440 * sample) / sampleRate);
		const offset = sample * bytesPerSample;
		wav.writeInt16LE(Math.round(amplitude * 8_000), 44 + offset);
	}
	return wav.toString("base64");
}

export function createAudioVerificationRequest(
	model: string,
	audioBase64 = createToneWavBase64(),
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "What do you hear in this audio? Reply in one short sentence.",
					},
					{
						type: "input_audio",
						input_audio: { data: audioBase64, format: "wav" },
					},
				],
			},
		],
	};
}

const TOOL_VERIFICATION_NAME = "get_weather";

/**
 * The `tool_choice` modes the tool check probes, strongest first. A listing
 * declares `tools`, not a tool_choice mode, so a mode the upstream mishandles
 * must narrow the mapping rather than disprove tool calling itself. "none" is
 * never probed: it asks for no tool call at all.
 */
const TOOL_CHOICE_LADDER = ["required", "function", "auto"] as const;

export function toolVerificationChoice(mode: ToolChoiceMode): ToolChoiceType {
	return mode === "function"
		? { type: "function", function: { name: TOOL_VERIFICATION_NAME } }
		: mode;
}

/** The ladder narrowed to what the listing claims, strongest mode first. */
export function toolVerificationModes(
	supported: ToolChoiceMode[] | null | undefined,
): ToolChoiceMode[] {
	if (!supported || supported.length === 0) {
		return [...TOOL_CHOICE_LADDER];
	}
	const modes = TOOL_CHOICE_LADDER.filter((mode) => supported.includes(mode));
	return modes.length > 0 ? modes : ["auto"];
}

export function createToolVerificationRequest(
	model: string,
	mode: ToolChoiceMode = "required",
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{
				role: "user",
				content: "Use get_weather to check the weather in San Francisco.",
			},
		],
		tools: [
			{
				type: "function",
				function: {
					name: TOOL_VERIFICATION_NAME,
					description: "Get the current weather for a city",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
		],
		tool_choice: toolVerificationChoice(mode),
	};
}

export function createJsonOutputVerificationRequest(
	model: string,
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{
				role: "system",
				content: "Respond with valid JSON and no markdown.",
			},
			{
				role: "user",
				content: 'Return an object with "message" set to "Hello World".',
			},
		],
		response_format: { type: "json_object" },
	};
}

export function createStructuredJsonVerificationRequest(
	model: string,
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Provide basic facts about France." },
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "country_facts",
				description: "Basic facts about a country",
				schema: COUNTRY_SCHEMA,
				strict: true,
			},
		},
	};
}

export function createReasoningVerificationRequest(
	model: string,
	effort: ModelVerificationRequest["reasoning_effort"] = "low",
): ModelVerificationRequest {
	return {
		model,
		messages: [{ role: "user", content: "What is 2/3 + 1/4 + 5/6?" }],
		reasoning_effort: effort,
	};
}

export function createWebSearchVerificationRequest(
	model: string,
): ModelVerificationRequest {
	return {
		model,
		messages: [
			{
				role: "user",
				content: "Search the web for today's date and state it briefly.",
			},
		],
		tools: [{ type: "web_search", search_context_size: "low" }],
		tool_choice: { type: "web_search" },
	};
}

// Natural-English prose runs ~4 chars/token; 3 keeps the prompt under the
// declared window even on a denser tokenizer.
const CONTEXT_CHARS_PER_TOKEN = 3;
const CONTEXT_FILL_RATIO = 0.7;
// Tokenizers vary, so the reported input only has to reach half the target.
const CONTEXT_MIN_REPORTED_RATIO = 0.5;
const CONTEXT_FILLER_SENTENCE =
	"The quick brown fox jumps over the lazy dog near the riverbank, while curious sparrows watched from the old oak tree branches above. ";

// Bounds the prompt a declared window can make the worker allocate; a larger
// window is verified up to this many tokens.
const CONTEXT_MAX_PROBE_TOKENS = 2_000_000;

function contextSizeTargetTokens(contextSize: number): number {
	return Math.min(
		Math.floor(contextSize * CONTEXT_FILL_RATIO),
		CONTEXT_MAX_PROBE_TOKENS,
	);
}

/** A prompt filling most of the declared context window. */
export function createContextSizeVerificationRequest(
	model: string,
	contextSize: number,
): ModelVerificationRequest {
	const chars = contextSizeTargetTokens(contextSize) * CONTEXT_CHARS_PER_TOKEN;
	const filler = CONTEXT_FILLER_SENTENCE.repeat(
		Math.ceil(chars / CONTEXT_FILLER_SENTENCE.length),
	).slice(0, chars);
	return {
		model,
		messages: [
			{
				role: "user",
				content: `Here is a long passage of text:\n\n${filler}\n\nNow reply with exactly OK.`,
			},
		],
		max_tokens: 64,
	};
}

/**
 * Asks for the full declared output budget. An endpoint with a lower cap
 * refuses the request; one that clamps silently cannot be told apart.
 */
export function createMaxOutputVerificationRequest(
	model: string,
	maxOutput: number,
): ModelVerificationRequest {
	return {
		...createBasicVerificationRequest(model),
		max_tokens: maxOutput,
	};
}

/**
 * Effort tiers the reasoning checks probe, in the order they are tried. Every
 * non-`none` tier proves reasoning equally well, so `medium` leads as the tier
 * most deployments accept — that keeps the usual run at a single request. The
 * rest are ordered by how often a deployment turns out not to implement them, so
 * a sweep cut short by its time budget has still asked the doubtful ones.
 */
const REASONING_EFFORT_PROBE_ORDER = [
	"medium",
	"minimal",
	"low",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ReasoningEffort[];

/**
 * How long a reasoning check keeps sweeping tiers after it has already proven
 * reasoning. Preflight runs rarely enough that the extra billed requests do not
 * matter, so the sweep is exhaustive — but the whole run still has to finish
 * inside the worker's stale window, and a pathologically slow endpoint can spend
 * the per-request timeout on every tier. Past this point the check keeps what it
 * has learned and stops; the tiers it never reached stay declared and a later
 * re-verify can still rule them out. The budget never applies before a tier has
 * passed: curtailing the search must not turn into disproving reasoning.
 */
const REASONING_EFFORT_SWEEP_BUDGET_MS = 4 * 60 * 1000;

/**
 * The tiers a reasoning check may walk. Deployments commonly accept only a
 * subset of the unified tiers and reject the rest outright — Runware's DeepSeek
 * V4.1, for one, 400s `minimal` and `medium` while serving
 * `low`/`high`/`xhigh`/`max` — so a rejected tier has to be retried at another
 * rather than read as the model not reasoning at all. A listing that declares
 * its tiers is probed only within them; one that declares none is probed across
 * the ladder. `none` is excluded: it proves nothing about reasoning.
 */
function reasoningVerificationEfforts(
	target: ProviderModelVerificationTarget,
): ReasoningEffort[] {
	const declared = (target.reasoningEfforts ?? []).filter(
		(effort) => effort !== "none",
	);
	return declared.length > 0
		? REASONING_EFFORT_PROBE_ORDER.filter((effort) => declared.includes(effort))
		: [...REASONING_EFFORT_PROBE_ORDER];
}

function verificationDefinitions(
	target: ProviderModelVerificationTarget,
): ModelVerificationDefinition[] {
	const definitions: ModelVerificationDefinition[] = [
		{
			id: "basic",
			label: "Basic completion",
			request: createBasicVerificationRequest(target.modelName),
		},
	];
	if (target.streaming) {
		definitions.push({
			id: "streaming",
			label: "Streaming",
			request: createStreamingVerificationRequest(target.modelName),
		});
	}
	if (target.vision) {
		definitions.push({
			id: "vision",
			label: "Vision input",
			request: createVisionVerificationRequest(target.modelName),
		});
	}
	if (target.audio) {
		definitions.push({
			id: "audio",
			label: "Audio input",
			request: createAudioVerificationRequest(target.modelName),
		});
	}
	if (target.tools) {
		definitions.push({
			id: "tools",
			label: "Tool calls",
			request: createToolVerificationRequest(
				target.modelName,
				toolVerificationModes(target.supportedToolChoices)[0],
			),
		});
	}
	if (target.jsonOutput) {
		definitions.push({
			id: "json_output",
			label: "JSON output",
			request: createJsonOutputVerificationRequest(target.modelName),
		});
	}
	if (target.jsonOutputSchema) {
		definitions.push({
			id: "structured_json",
			label: "Structured JSON",
			request: createStructuredJsonVerificationRequest(target.modelName),
		});
	}
	const [reasoningEffort] = reasoningVerificationEfforts(target);
	if (target.reasoning) {
		definitions.push({
			id: "reasoning",
			label: "Reasoning",
			request: createReasoningVerificationRequest(
				target.modelName,
				reasoningEffort,
			),
		});
	}
	if (target.reasoningMaxTokens) {
		definitions.push({
			id: "reasoning_budget",
			label: "Reasoning budget",
			request: createReasoningVerificationRequest(
				target.modelName,
				reasoningEffort,
			),
		});
	}
	if (target.webSearch) {
		definitions.push({
			id: "web_search",
			label: "Web search",
			request: createWebSearchVerificationRequest(target.modelName),
		});
	}
	const { contextSize } = target;
	if (contextSize) {
		// Built on first use: queueing a run lists the checks without allocating
		// the prompt.
		let request: ModelVerificationRequest | undefined;
		definitions.push({
			id: "context_size",
			label: "Context size",
			get request() {
				return (request ??= createContextSizeVerificationRequest(
					target.modelName,
					contextSize,
				));
			},
		});
	}
	if (target.maxOutput) {
		definitions.push({
			id: "max_output",
			label: "Max output",
			request: createMaxOutputVerificationRequest(
				target.modelName,
				target.maxOutput,
			),
		});
	}
	return definitions;
}

/**
 * The listing capability each check proves. A failed check disproves exactly
 * its own flag, so a listing can be demoted to what it actually does instead
 * of keeping a claim the endpoint just rejected. `basic` maps to nothing: a
 * model that cannot complete at all has no single flag to blame.
 */
export const MODEL_VERIFICATION_CHECK_CAPABILITY = {
	streaming: "streaming",
	vision: "vision",
	audio: "audio",
	tools: "tools",
	json_output: "jsonOutput",
	structured_json: "jsonOutputSchema",
	reasoning: "reasoning",
	reasoning_budget: "reasoningMaxTokens",
	web_search: "webSearch",
} as const satisfies Partial<Record<ModelVerificationCheckId, string>>;

export type ModelVerificationCapability =
	(typeof MODEL_VERIFICATION_CHECK_CAPABILITY)[keyof typeof MODEL_VERIFICATION_CHECK_CAPABILITY];

/** The capabilities a completed run disproved, from its failed checks only. */
export function disprovedCapabilities(
	checks: ProviderModelVerificationCheck[],
): ModelVerificationCapability[] {
	const capabilities: ModelVerificationCapability[] = [];
	for (const check of checks) {
		if (check.status !== "failed") {
			continue;
		}
		const capability =
			MODEL_VERIFICATION_CHECK_CAPABILITY[
				check.id as keyof typeof MODEL_VERIFICATION_CHECK_CAPABILITY
			];
		if (capability) {
			capabilities.push(capability);
		}
	}
	return capabilities;
}

export function createQueuedModelVerificationChecks(
	target: ProviderModelVerificationTarget,
): ProviderModelVerificationCheck[] {
	return verificationDefinitions(target).map(({ id, label }) => ({
		id,
		label,
		status: "queued",
	}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atPath(value: unknown, path: string[]): unknown {
	let current = value;
	for (const key of path) {
		if (Array.isArray(current) && /^\d+$/.test(key)) {
			current = current[Number(key)];
			continue;
		}
		if (!isRecord(current)) {
			return undefined;
		}
		current = current[key];
	}
	return current;
}

function textFromContent(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (!Array.isArray(value)) {
		return "";
	}
	return value
		.map((part) => {
			if (!isRecord(part)) {
				return "";
			}
			return typeof part.text === "string"
				? part.text
				: typeof part.output_text === "string"
					? part.output_text
					: "";
		})
		.join("");
}

function extractAssistantText(body: unknown): string {
	const candidates = [
		atPath(body, ["choices", "0", "message", "content"]),
		atPath(body, ["candidates", "0", "content", "parts"]),
		atPath(body, ["output", "message", "content"]),
		isRecord(body) ? body.content : undefined,
	];
	for (const candidate of candidates) {
		const text = textFromContent(candidate).trim();
		if (text) {
			return text;
		}
	}
	if (isRecord(body) && Array.isArray(body.output)) {
		for (const item of body.output) {
			if (!isRecord(item)) {
				continue;
			}
			const text = textFromContent(item.content).trim();
			if (text) {
				return text;
			}
		}
	}
	return "";
}

function containsNamedTool(value: unknown, name: string): boolean {
	if (Array.isArray(value)) {
		return value.some((entry) => containsNamedTool(entry, name));
	}
	if (!isRecord(value)) {
		return false;
	}
	if (
		(value.type === "tool_use" ||
			value.type === "function_call" ||
			value.type === "function") &&
		value.name === name
	) {
		return true;
	}
	if (isRecord(value.function) && value.function.name === name) {
		return true;
	}
	if (isRecord(value.functionCall) && value.functionCall.name === name) {
		return true;
	}
	return Object.values(value).some((entry) => containsNamedTool(entry, name));
}

function isCompletedSearchStatus(value: unknown): boolean {
	return (
		typeof value === "string" &&
		["completed", "succeeded", "success"].includes(value.toLowerCase())
	);
}

function containsWebSearchEvidence(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(containsWebSearchEvidence);
	}
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.type === "string") {
		if (value.type.includes("search_result")) {
			return Object.keys(value).some((key) => key !== "type");
		}
		if (value.type.includes("web_search_call")) {
			return isCompletedSearchStatus(value.status);
		}
	}
	return Object.entries(value).some(([key, entry]) => {
		if (key === "web_search_call") {
			return isRecord(entry) && isCompletedSearchStatus(entry.status);
		}
		if (
			[
				"annotations",
				"citations",
				"groundingMetadata",
				"search_results",
			].includes(key) &&
			((Array.isArray(entry) && entry.length > 0) ||
				(isRecord(entry) && Object.keys(entry).length > 0))
		) {
			return true;
		}
		return containsWebSearchEvidence(entry);
	});
}

const REASONING_TEXT_KEYS = new Set([
	"reasoning",
	"reasoning_content",
	"reasoning_details",
	"reasoningContent",
]);
const REASONING_TOKEN_KEYS = new Set([
	"reasoning_tokens",
	"reasoning_output_tokens",
	"thinking_tokens",
	"thoughtsTokenCount",
]);
const REASONING_BLOCK_TYPES = new Set([
	"reasoning",
	"thinking",
	"redacted_thinking",
]);

/**
 * Whether a response shows the model reasoned: reasoning text, a reasoning or
 * thinking block, or a positive reasoning token count. An endpoint that accepts
 * `reasoning_effort` but ignores it answers without any of these.
 */
function containsReasoningEvidence(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(containsReasoningEvidence);
	}
	if (!isRecord(value)) {
		return false;
	}
	if (
		(typeof value.type === "string" && REASONING_BLOCK_TYPES.has(value.type)) ||
		value.thought === true
	) {
		return true;
	}
	return Object.entries(value).some(([key, entry]) => {
		if (REASONING_TOKEN_KEYS.has(key)) {
			return typeof entry === "number" && entry > 0;
		}
		// An object under `reasoning` is the Responses request echo
		// ({effort, summary}), not output — except Bedrock's reasoningContent.
		if (
			REASONING_TEXT_KEYS.has(key) &&
			((typeof entry === "string" && entry.trim()) ||
				(Array.isArray(entry) && entry.length > 0) ||
				(key === "reasoningContent" && isRecord(entry)))
		) {
			return true;
		}
		if (key === "content" && typeof entry === "string") {
			return entry.includes("<think>");
		}
		return containsReasoningEvidence(entry);
	});
}

/**
 * Whether billing-data defects fail their check. While false they pass it with
 * a warning, so carriers can fix them before they start blocking listings.
 */
const BILLING_DATA_CHECKS_REQUIRED = false;

/**
 * Protocol defects in an otherwise served response that no other probe variant
 * would fix: the gateway passes them straight through to developers, or bills
 * from them.
 */
function responseDefect(
	id: ModelVerificationCheckId,
	body: unknown,
	request: ModelVerificationRequest,
): string | null {
	const choice = atPath(body, ["choices", "0"]);
	const chatCompletion = isRecord(body) && isRecord(choice);
	if (id === "basic") {
		if (chatCompletion && typeof body.id !== "string") {
			return "The response has no id. Chat Completions responses must include id, object and created.";
		}
		return usageDefect(reportedUsage(body), "The response");
	}
	// A named tool_choice legitimately finishes with "stop" on OpenAI itself.
	if (
		id === "tools" &&
		chatCompletion &&
		typeof request.tool_choice !== "object"
	) {
		const toolCalls = atPath(choice, ["message", "tool_calls"]);
		if (
			Array.isArray(toolCalls) &&
			toolCalls.length > 0 &&
			choice.finish_reason !== "tool_calls"
		) {
			return `The response contains tool_calls but finish_reason is ${JSON.stringify(choice.finish_reason ?? null)}. It must be "tool_calls", or clients stop instead of running the tool.`;
		}
	}
	if (
		(id === "reasoning" || id === "reasoning_budget") &&
		!containsReasoningEvidence(body)
	) {
		return "The response showed no reasoning: no reasoning content and no reasoning tokens in usage. reasoning_effort must turn reasoning on.";
	}
	return null;
}

function parseJsonOutput(text: string): unknown {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	return JSON.parse(trimmed) as unknown;
}

function validateStructuredCountry(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.capital === "string" &&
		typeof value.continent === "string" &&
		Object.keys(value).every((key) => key in COUNTRY_SCHEMA.properties)
	);
}

function tokenCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Token counts the gateway bills from; a field is undefined when unreported. */
interface ReportedUsage {
	/** Every processed input token, cached ones included. */
	input?: number;
	/** Every generated token, reasoning included where reported separately. */
	output?: number;
	cached?: number;
}

/**
 * The usage a response body or stream event reports, across the usage shapes
 * of the supported protocols.
 */
function reportedUsage(body: unknown): ReportedUsage {
	const google = atPath(body, ["usageMetadata"]);
	if (isRecord(google)) {
		const candidates = optionalCount(google.candidatesTokenCount);
		return {
			input: optionalCount(google.promptTokenCount),
			output:
				candidates === undefined
					? undefined
					: candidates + tokenCount(google.thoughtsTokenCount),
			cached: optionalCount(google.cachedContentTokenCount),
		};
	}
	// Responses stream events nest it under `response`, Anthropic's
	// message_start under `message`.
	const usage =
		atPath(body, ["usage"]) ??
		atPath(body, ["response", "usage"]) ??
		atPath(body, ["message", "usage"]);
	if (!isRecord(usage)) {
		return {};
	}
	if (
		usage.prompt_tokens !== undefined ||
		usage.completion_tokens !== undefined
	) {
		return {
			input: optionalCount(usage.prompt_tokens),
			output: optionalCount(usage.completion_tokens),
			cached: optionalCount(
				atPath(usage, ["prompt_tokens_details", "cached_tokens"]),
			),
		};
	}
	if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
		const input = optionalCount(usage.inputTokens);
		return {
			input:
				input === undefined
					? undefined
					: input +
						tokenCount(usage.cacheReadInputTokens) +
						tokenCount(usage.cacheWriteInputTokens),
			output: optionalCount(usage.outputTokens),
			cached: optionalCount(usage.cacheReadInputTokens),
		};
	}
	// Anthropic Messages and OpenAI Responses. Only Anthropic reports cache
	// reads and writes outside input_tokens.
	const input = optionalCount(usage.input_tokens);
	return {
		input:
			input === undefined
				? undefined
				: input +
					tokenCount(usage.cache_read_input_tokens) +
					tokenCount(usage.cache_creation_input_tokens),
		output: optionalCount(usage.output_tokens),
		cached: optionalCount(
			usage.cache_read_input_tokens ??
				atPath(usage, ["input_tokens_details", "cached_tokens"]),
		),
	};
}

/**
 * The usage the gateway bills a stream at: like the gateway, the last value a
 * stream reports for a field replaces every earlier one.
 */
function mergeStreamUsage(events: unknown[]): ReportedUsage {
	const merged: ReportedUsage = {};
	for (const event of events) {
		const usage = reportedUsage(event);
		merged.input = usage.input ?? merged.input;
		merged.output = usage.output ?? merged.output;
		merged.cached = usage.cached ?? merged.cached;
	}
	return merged;
}

/**
 * Why the reported usage cannot be billed, or null. Every listing is billed
 * from these counts, so a response without them is a failed check rather than
 * something the gateway papers over with an estimate.
 */
function usageDefect(usage: ReportedUsage, source: string): string | null {
	if (usage.input === undefined && usage.output === undefined) {
		return `${source} did not report token usage. Input and output token counts are required for billing.`;
	}
	for (const [kind, count] of Object.entries(usage)) {
		if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
			return `${source} reported ${count} ${kind} tokens. Token counts must be non-negative integers.`;
		}
	}
	if (!usage.input || usage.input <= 0) {
		return `${source} reported ${usage.input ?? "no"} input tokens. A positive input token count is required for billing.`;
	}
	if (!usage.output || usage.output <= 0) {
		return `${source} reported ${usage.output ?? "no"} output tokens. A positive output token count is required for billing.`;
	}
	if (usage.cached !== undefined && usage.cached > usage.input) {
		return `${source} reported ${usage.cached} cached input tokens out of ${usage.input} input tokens. Cached tokens must be counted within the input tokens.`;
	}
	return null;
}

// The streaming and basic checks send the same prompt, so their input counts
// should agree; the slack only absorbs serving-stack differences.
const STREAM_INPUT_TOLERANCE_RATIO = 0.25;
const STREAM_INPUT_TOLERANCE_TOKENS = 4;

function streamInputMismatch(
	streamed: number,
	basic: number | undefined,
): string | null {
	if (basic === undefined) {
		return null;
	}
	const tolerance = Math.max(
		STREAM_INPUT_TOLERANCE_TOKENS,
		basic * STREAM_INPUT_TOLERANCE_RATIO,
	);
	return Math.abs(streamed - basic) > tolerance
		? `The stream reported ${streamed} input tokens for the prompt the non-streaming request reported ${basic} input tokens for. A stream must report the same totals; usage sent per chunk as increments is billed at its last value.`
		: null;
}

/** Input tokens the upstream says it processed, cached ones included. */
function reportedInputTokens(body: unknown): number | undefined {
	return reportedUsage(body).input;
}

function validateContextSize(
	body: unknown,
	contextSize: number,
): string | null {
	// A 200 can still carry a failed operation, e.g. a Responses envelope.
	if (isRecord(body) && (body.error || body.status === "failed")) {
		const message = isRecord(body.error) ? body.error.message : body.error;
		return typeof message === "string" && message
			? message.slice(0, 500)
			: "The provider reported a failed response.";
	}
	const reported = reportedInputTokens(body);
	const expected = Math.floor(
		contextSizeTargetTokens(contextSize) * CONTEXT_MIN_REPORTED_RATIO,
	);
	return reported !== undefined && reported < expected
		? `The provider reported ${reported} input tokens for a prompt of at least ${expected}; the input may have been truncated.`
		: null;
}

function validateResponse(
	id: ModelVerificationCheckId,
	body: unknown,
	target: ProviderModelVerificationTarget,
): string | null {
	const assistantText = extractAssistantText(body);
	switch (id) {
		// Accepting the prompt is the proof; a small output budget can leave a
		// reasoning model with no visible text.
		case "context_size":
			return validateContextSize(body, target.contextSize ?? 0);
		case "vision":
			return /\bred\b/i.test(assistantText)
				? null
				: "The response did not identify the red image.";
		case "audio":
			return /\b(?:tone|beep|sine(?: wave)?|440(?:\s*(?:hz|hertz))?|a4)\b/i.test(
				assistantText,
			)
				? null
				: "The response did not identify the test tone.";
		case "tools":
			return containsNamedTool(body, "get_weather")
				? null
				: "The response did not contain the required get_weather tool call.";
		case "json_output":
			try {
				const parsed = parseJsonOutput(assistantText);
				return isRecord(parsed) && typeof parsed.message === "string"
					? null
					: "The response was JSON but did not match the requested object.";
			} catch {
				return "The response was not valid JSON.";
			}
		case "structured_json":
			try {
				return validateStructuredCountry(parseJsonOutput(assistantText))
					? null
					: "The response did not match the requested JSON schema.";
			} catch {
				return "The structured response was not valid JSON.";
			}
		case "web_search":
			if (!assistantText) {
				return "The provider returned no assistant content.";
			}
			return containsWebSearchEvidence(body)
				? null
				: "The response did not contain evidence of a web search.";
		default:
			return assistantText
				? null
				: "The provider returned no assistant content.";
	}
}

function parseStreamEvents(body: string): unknown[] | null {
	const data = body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trim())
		.filter((value) => value && value !== "[DONE]");
	if (data.length === 0) {
		return null;
	}
	return data.flatMap((value) => {
		try {
			return [JSON.parse(value) as unknown];
		} catch {
			return [];
		}
	});
}

/** Visible text one stream event adds, across the supported protocols. */
function streamEventText(event: unknown): string {
	if (!isRecord(event)) {
		return "";
	}
	if (event.type === "response.output_text.delta") {
		return typeof event.delta === "string" ? event.delta : "";
	}
	if (event.type === "content_block_delta") {
		return textFromContent([event.delta]);
	}
	return (
		textFromContent(atPath(event, ["choices", "0", "delta", "content"])) ||
		textFromContent(atPath(event, ["candidates", "0", "content", "parts"]))
	);
}

function isStreamEnd(event: unknown): boolean {
	if (!isRecord(event)) {
		return false;
	}
	if (event.type === "response.completed" || event.type === "message_stop") {
		return true;
	}
	return Boolean(
		atPath(event, ["delta", "stop_reason"]) ||
		atPath(event, ["candidates", "0", "finishReason"]) ||
		(Array.isArray(event.choices) &&
			event.choices.some((choice) => isRecord(choice) && choice.finish_reason)),
	);
}

/**
 * A stream is billed from the usage it reports, so the check holds it to what
 * the gateway needs: text, a finish reason, and complete usage that agrees
 * with the non-streaming request for the same prompt.
 */
function streamDefect(
	events: unknown[],
	basicUsage: ReportedUsage | undefined,
): string | null {
	if (!events.some((event) => streamEventText(event).trim())) {
		return "The stream did not contain any assistant text.";
	}
	if (!events.some(isStreamEnd)) {
		return "The stream ended without a finish reason.";
	}
	const usage = mergeStreamUsage(events);
	const defect = usageDefect(usage, "The stream");
	if (defect) {
		return usage.input === undefined && usage.output === undefined
			? `${defect} OpenAI-compatible streams must honour stream_options.include_usage with a final usage chunk.`
			: defect;
	}
	// Chat Completions usage counted before the finish chunk misses the output
	// generated after it.
	let lastEnd = events.length - 1;
	while (!isStreamEnd(events[lastEnd])) {
		lastEnd--;
	}
	if (
		events.some((event) => isRecord(event) && Array.isArray(event.choices)) &&
		!events
			.slice(lastEnd)
			.some((event) => reportedUsage(event).output !== undefined)
	) {
		return "The stream reported usage only before its finish reason. OpenAI-compatible streams must send the final usage in or after the chunk that carries finish_reason.";
	}
	return streamInputMismatch(usage.input ?? 0, basicUsage?.input);
}

function upstreamErrorMessage(body: string, status: number): string {
	try {
		const parsed = JSON.parse(body) as unknown;
		if (isRecord(parsed)) {
			const nested = isRecord(parsed.error) ? parsed.error.message : undefined;
			if (typeof nested === "string") {
				return nested.slice(0, 500);
			}
			if (typeof parsed.message === "string") {
				return parsed.message.slice(0, 500);
			}
		}
	} catch {
		// Fall through to the bounded plain-text response.
	}
	return body.trim().slice(0, 500) || `Provider returned HTTP ${status}.`;
}

function splitTools(tools: OpenAIToolInput[] | undefined): {
	functionTools: OpenAIToolInput[] | undefined;
	webSearchTool: WebSearchTool | undefined;
} {
	if (!tools) {
		return { functionTools: undefined, webSearchTool: undefined };
	}
	const functionTools = tools.filter((tool) => tool.type !== "web_search");
	const search = tools.find((tool) => tool.type === "web_search");
	return {
		functionTools: functionTools.length > 0 ? functionTools : undefined,
		webSearchTool:
			search?.type === "web_search"
				? {
						type: "web_search",
						search_context_size: search.search_context_size,
						max_uses: search.max_uses,
					}
				: undefined,
	};
}

function isGoogleQueryTokenProvider(provider: ProviderId): boolean {
	return [
		"google-ai-studio",
		"glacier",
		"google-vertex",
		"quartz",
		"vertex-anthropic",
	].includes(provider);
}

function redactSecrets(text: string, secrets: Iterable<string>): string {
	let redacted = text;
	for (const secret of secrets) {
		redacted = redactToken(redacted, secret);
	}
	return redacted;
}

interface CheckFailure {
	message: string;
	/**
	 * The upstream refused the request itself (4xx) rather than failing to serve
	 * it. Only a refusal is evidence about what the deployment supports; a 5xx or
	 * a transport error says nothing and must never narrow a listing.
	 */
	rejected: boolean;
	/**
	 * The response was served but carries a protocol defect no other probe
	 * variant would fix, so a ladder stops instead of narrowing the listing.
	 */
	conclusive?: boolean;
}

interface CheckContext {
	secrets: Set<string>;
	/** Billing-data defects the current check passed with, while not required. */
	billingWarnings: Set<string>;
	requireBillingData?: boolean;
	/** What the basic completion reported, for the streaming check to match. */
	basicUsage?: ReportedUsage;
	/** A key smoke test proves the key works; billing data is preflight's. */
	keyOnly?: boolean;
}

/**
 * Tries a request that timed out gets. A slow response says nothing about what
 * the deployment supports, so it is retried rather than failing the check.
 */
const CHECK_TIMEOUT_ATTEMPTS = 3;

/** Called before a timed-out request is retried, with the attempt that failed. */
type TimeoutReporter = (attempt: number) => Promise<void> | void;

function isTimeoutError(error: unknown): boolean {
	return error instanceof Error && error.name === "TimeoutError";
}

async function attemptCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	context: CheckContext,
	onTimeout?: TimeoutReporter,
): Promise<CheckFailure | null> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await executeCheck(definition, options, context);
		} catch (error) {
			const timedOut = isTimeoutError(error);
			if (timedOut && attempt < CHECK_TIMEOUT_ATTEMPTS) {
				await onTimeout?.(attempt);
				continue;
			}
			const message = redactSecrets(
				(error instanceof Error
					? error.message
					: "Verification request failed."
				).slice(0, 500),
				context.secrets,
			);
			return {
				message: timedOut
					? `${message} (timed out on all ${CHECK_TIMEOUT_ATTEMPTS} attempts)`
					: message,
				rejected: false,
			};
		}
	}
}

interface CheckOutcome {
	failure: CheckFailure | null;
	/** Probed `tool_choice` modes the upstream did not honour. */
	unsupportedToolChoices?: ToolChoiceMode[];
	/** Probed reasoning effort tiers the upstream refused. */
	unsupportedReasoningEfforts?: ReasoningEffort[];
	/** Replaces the generic "Passed" once a probe found something worth saying. */
	feedback?: string;
	/** Per-request breakdown for checks that probe more than one variant. */
	probes?: ProviderModelVerificationProbe[];
}

/**
 * Publishes the probes a running check has made so far, so a ladder that takes
 * several billed requests shows its progress instead of one opaque spinner.
 */
type ProbeReporter = (
	probes: ProviderModelVerificationProbe[],
) => Promise<void> | void;

function probeResult(
	label: string,
	failure: CheckFailure | null,
): ProviderModelVerificationProbe {
	return failure
		? { label, status: "failed", feedback: failure.message }
		: { label, status: "passed" };
}

/**
 * Walk the effort ladder so a tier the deployment refuses narrows the listing's
 * declared tiers instead of disproving reasoning altogether.
 *
 * A deployment that takes the first tier accepts the unified enum and the check
 * stops there — one request, as before. Once a tier is refused every remaining
 * tier is probed instead, because the tiers left declared are the ones the
 * gateway will forward verbatim: leaving an untried tier in the list only moves
 * the 4xx from preflight to a developer's request. Refusals are the only
 * evidence used, so a 5xx or a transport error stops the sweep without taking a
 * tier away.
 */
async function runReasoningCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	context: CheckContext,
	knownUnsupported: ReasoningEffort[],
	reportProbes: ProbeReporter,
	onTimeout: TimeoutReporter,
): Promise<CheckOutcome> {
	const efforts = reasoningVerificationEfforts(options.target).filter(
		(effort) => !knownUnsupported.includes(effort),
	);
	const probes: ProviderModelVerificationProbe[] = knownUnsupported.map(
		(effort) => ({
			label: `reasoning_effort: ${effort}`,
			status: "failed",
			feedback: "Refused by an earlier reasoning check.",
		}),
	);
	const unsupportedReasoningEfforts: ReasoningEffort[] = [];
	let passedEffort: ReasoningEffort | undefined;
	let lastFailure: CheckFailure | null = null;
	const startedAt = Date.now();
	for (const effort of efforts) {
		if (
			passedEffort &&
			Date.now() - startedAt > REASONING_EFFORT_SWEEP_BUDGET_MS
		) {
			break;
		}
		const failure = await attemptCheck(
			{
				...definition,
				request: { ...definition.request, reasoning_effort: effort },
			},
			options,
			context,
			onTimeout,
		);
		probes.push(probeResult(`reasoning_effort: ${effort}`, failure));
		await reportProbes(probes);
		if (!failure) {
			passedEffort ??= effort;
			if (unsupportedReasoningEfforts.length === 0) {
				break;
			}
			continue;
		}
		lastFailure = failure;
		if (!failure.rejected) {
			break;
		}
		unsupportedReasoningEfforts.push(effort);
	}
	if (!passedEffort) {
		return { failure: lastFailure, probes };
	}
	return {
		failure: null,
		unsupportedReasoningEfforts,
		probes,
		feedback: unsupportedReasoningEfforts.length
			? `Passed at ${passedEffort} effort. Refused: ${unsupportedReasoningEfforts.join(", ")}.`
			: undefined,
	};
}

/**
 * An upstream refusal of a limit probe is worded for whoever sent the request
 * ("your messages resulted in…"), which reads as nonsense to a carrier who sent
 * nothing. Say what the probe was before quoting the answer.
 */
function explainLimitRefusal(
	id: ModelVerificationCheckId,
	target: ProviderModelVerificationTarget,
	failure: CheckFailure | null,
): CheckFailure | null {
	if (!failure?.rejected) {
		return failure;
	}
	const tokens = (count: number) => count.toLocaleString("en-US");
	let probe: string;
	if (id === "context_size" && target.contextSize) {
		const sent = contextSizeTargetTokens(target.contextSize);
		probe =
			sent === CONTEXT_MAX_PROBE_TOKENS
				? `a test prompt of about ${tokens(sent)} tokens, the most preflight sends for the declared ${tokens(target.contextSize)}-token context size`
				: `a test prompt filling about 70% of the declared ${tokens(target.contextSize)}-token context size`;
	} else if (id === "max_output" && target.maxOutput) {
		probe = `a request for the declared max output of ${tokens(target.maxOutput)} tokens`;
	} else {
		return failure;
	}
	return {
		...failure,
		message: `Your endpoint refused ${probe}. It answered: "${failure.message}"`,
	};
}

async function runCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	context: CheckContext,
	knownUnsupportedReasoningEfforts: ReasoningEffort[],
	reportProbes: ProbeReporter,
	onTimeout: TimeoutReporter,
): Promise<CheckOutcome> {
	if (definition.id === "reasoning" || definition.id === "reasoning_budget") {
		return await runReasoningCheck(
			definition,
			options,
			context,
			knownUnsupportedReasoningEfforts,
			reportProbes,
			onTimeout,
		);
	}
	if (definition.id !== "tools") {
		return {
			failure: explainLimitRefusal(
				definition.id,
				options.target,
				await attemptCheck(definition, options, context, onTimeout),
			),
		};
	}
	// Several OpenAI-compatible serving stacks mishandle the forcing modes and
	// answer "required" with the model's raw tool markup as assistant content.
	// Walk down the ladder so a mishandled mode narrows the mapping instead of
	// disproving tool calling, and so each narrowing rests on a real probe.
	const modes = toolVerificationModes(options.target.supportedToolChoices);
	const unsupportedToolChoices: ToolChoiceMode[] = [];
	const probes: ProviderModelVerificationProbe[] = [];
	let failure: CheckFailure | null = null;
	for (const mode of modes) {
		failure = await attemptCheck(
			{
				...definition,
				request: {
					...definition.request,
					tool_choice: toolVerificationChoice(mode),
				},
			},
			options,
			context,
			onTimeout,
		);
		probes.push(probeResult(`tool_choice: ${mode}`, failure));
		await reportProbes(probes);
		if (!failure) {
			return { failure: null, unsupportedToolChoices, probes };
		}
		if (failure.conclusive) {
			break;
		}
		unsupportedToolChoices.push(mode);
	}
	return { failure, probes };
}

async function executeCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	context: CheckContext,
): Promise<CheckFailure | null> {
	const knownProvider = providers.some(
		(provider) => provider.id === options.target.providerId,
	);
	if (!knownProvider && !options.baseUrl) {
		return {
			message: `Provider ${options.target.providerId} has no registered endpoint.`,
			rejected: false,
		};
	}
	if (options.baseUrl) {
		await assertSafeProviderUrl(options.baseUrl);
	}
	const provider = (
		knownProvider ? options.target.providerId : "custom"
	) as ProviderId;
	const transportProvider = getProviderApiTransport(
		provider,
		options.target.apiFormat,
	);
	let requestToken = options.token;
	if (
		provider === "vertex-anthropic" ||
		provider === "vertex-openai" ||
		(provider === "google-vertex" && options.token.trim().startsWith("{"))
	) {
		requestToken = await getGcpServiceAccountAccessToken(options.token);
	}
	context.secrets.add(requestToken);
	const endpoint = getProviderEndpoint(
		provider,
		options.baseUrl,
		options.target.externalId,
		isGoogleQueryTokenProvider(provider) ||
			transportProvider === "google-vertex"
			? requestToken
			: undefined,
		definition.request.stream ?? false,
		options.target.reasoning,
		false,
		options.providerKeyOptions,
		undefined,
		false,
		options.target.region ?? undefined,
		options.skipEnvVars,
		options.target.modelName,
		transportProvider === "google-vertex" && provider !== "google-vertex"
			? "api-key"
			: undefined,
		undefined,
		options.target.apiFormat,
	);
	const useResponsesApi = options.target.apiFormat === "openai-responses";
	const { functionTools, webSearchTool } = splitTools(definition.request.tools);
	let payload = await prepareRequestBody(
		transportProvider,
		options.target.modelName,
		null,
		getUpstreamModelId(
			provider,
			options.target.modelName,
			options.target.externalId,
			options.target.region,
		),
		definition.request.messages,
		definition.request.stream ?? false,
		definition.request.temperature,
		definition.request.max_tokens,
		undefined,
		undefined,
		undefined,
		definition.request.response_format,
		functionTools,
		definition.request.tool_choice,
		definition.request.reasoning_effort,
		options.target.reasoning,
		false,
		20,
		null,
		undefined,
		undefined,
		undefined,
		false,
		webSearchTool,
		definition.id === "reasoning_budget" ? 256 : undefined,
		useResponsesApi,
	);
	// The OpenAI Responses body always carries a reasoning block (every OpenAI
	// model on that surface reasons). A carrier listing that declares no
	// reasoning runs against an endpoint that rejects it, so drop it — and the
	// encrypted reasoning payload it would return — from the preflight.
	if (
		useResponsesApi &&
		!options.target.reasoning &&
		!(payload instanceof FormData)
	) {
		const {
			reasoning: _reasoning,
			include: _include,
			...withoutReasoning
		} = payload as OpenAIResponsesRequestBody;
		payload = withoutReasoning as ProviderRequestBody;
	}
	const headers = getProviderHeaders(transportProvider, requestToken, {
		providerKeyOptions: options.providerKeyOptions,
		skipEnvVars: options.skipEnvVars,
		tokenType:
			transportProvider === "google-vertex" && provider !== "google-vertex"
				? "api-key"
				: undefined,
	});
	if (!(payload instanceof FormData)) {
		headers["Content-Type"] = "application/json";
	}
	if (
		provider === "anthropic" &&
		definition.request.response_format?.type === "json_schema"
	) {
		headers["anthropic-beta"] = "structured-outputs-2025-11-13";
	}
	const response = await (options.fetchImplementation ?? fetch)(endpoint, {
		method: "POST",
		redirect: "error",
		headers,
		body: payload instanceof FormData ? payload : JSON.stringify(payload),
		signal: AbortSignal.timeout(
			definition.id === "web_search" || definition.id === "context_size"
				? 300_000
				: 120_000,
		),
	});
	const bodyText = await response.text();
	if (!response.ok) {
		return {
			message: redactSecrets(
				upstreamErrorMessage(bodyText, response.status),
				context.secrets,
			),
			rejected: response.status >= 400 && response.status < 500,
		};
	}
	if (definition.request.stream) {
		const events = parseStreamEvents(bodyText);
		if (!events) {
			return {
				message: "The response did not contain any streaming events.",
				rejected: false,
			};
		}
		return billingDefect(streamDefect(events, context.basicUsage), context);
	}
	let body: unknown;
	try {
		body = JSON.parse(bodyText) as unknown;
	} catch {
		return {
			message: "The provider returned a non-JSON response.",
			rejected: false,
		};
	}
	if (definition.id === "basic") {
		context.basicUsage = reportedUsage(body);
	}
	const invalid = validateResponse(definition.id, body, options.target);
	if (invalid) {
		return { message: invalid, rejected: false };
	}
	return billingDefect(
		responseDefect(definition.id, body, definition.request),
		context,
	);
}

/** Fails on a billing-data defect once required; until then, warns. */
function billingDefect(
	defect: string | null,
	context: CheckContext,
): CheckFailure | null {
	if (!defect || context.keyOnly) {
		return null;
	}
	if (context.requireBillingData) {
		return { message: defect, rejected: false, conclusive: true };
	}
	context.billingWarnings.add(defect);
	return null;
}

export async function runProviderModelVerification(
	options: RunModelVerificationOptions,
): Promise<ModelVerificationRunResult> {
	const definitions = verificationDefinitions(options.target);
	const checks = createQueuedModelVerificationChecks(options.target);
	const context: CheckContext = {
		secrets: new Set([options.token]),
		billingWarnings: new Set(),
		requireBillingData:
			options.requireBillingData ?? BILLING_DATA_CHECKS_REQUIRED,
	};
	let unsupportedToolChoices: ToolChoiceMode[] | undefined;
	let unsupportedReasoningEfforts: ReasoningEffort[] | undefined;
	for (let index = 0; index < definitions.length; index++) {
		const definition = definitions[index];
		const running: ProviderModelVerificationCheck = {
			id: definition.id,
			label: definition.label,
			status: "running",
		};
		checks[index] = running;
		await options.onCheck?.(running);
		context.billingWarnings.clear();
		let progress = running;
		const report = async (update: Partial<ProviderModelVerificationCheck>) => {
			progress = { ...progress, ...update };
			checks[index] = progress;
			await options.onCheck?.(progress);
		};
		let timeouts = 0;
		const outcome = await runCheck(
			definition,
			options,
			context,
			unsupportedReasoningEfforts ?? [],
			async (probes) => await report({ probes: [...probes] }),
			async (attempt) => {
				timeouts++;
				await report({
					warning: `Timed out; retrying (attempt ${attempt + 1} of ${CHECK_TIMEOUT_ATTEMPTS}).`,
				});
			},
		);
		const failure = outcome.failure;
		if (outcome.unsupportedToolChoices?.length) {
			unsupportedToolChoices = outcome.unsupportedToolChoices;
		}
		if (outcome.unsupportedReasoningEfforts?.length) {
			unsupportedReasoningEfforts = [
				...(unsupportedReasoningEfforts ?? []),
				...outcome.unsupportedReasoningEfforts.filter(
					(effort) => !unsupportedReasoningEfforts?.includes(effort),
				),
			];
		}
		const completed: ProviderModelVerificationCheck = failure
			? {
					id: definition.id,
					label: definition.label,
					status: "failed",
					feedback: failure.message,
					...(outcome.probes?.length ? { probes: outcome.probes } : {}),
				}
			: {
					id: definition.id,
					label: definition.label,
					status: "passed",
					feedback: outcome.feedback ?? "Passed",
					...(timeouts > 0
						? {
								warning: `Passed after ${timeouts} timed-out ${timeouts === 1 ? "request" : "requests"}; the endpoint may be slow or overloaded.`,
							}
						: {}),
					...(context.billingWarnings.size > 0
						? { billingWarnings: [...context.billingWarnings] }
						: {}),
					...(outcome.probes?.length ? { probes: outcome.probes } : {}),
				};
		checks[index] = completed;
		await options.onCheck?.(completed);
		// A billing-data defect means the endpoint served the request, so the
		// capability checks still have something to verify.
		if (definition.id === "basic" && failure && !failure.conclusive) {
			for (let rest = index + 1; rest < definitions.length; rest++) {
				const skipped: ProviderModelVerificationCheck = {
					id: definitions[rest].id,
					label: definitions[rest].label,
					status: "skipped",
					feedback: "Skipped because the basic completion failed.",
				};
				checks[rest] = skipped;
				await options.onCheck?.(skipped);
			}
			break;
		}
	}
	const failed = checks.filter((check) => check.status === "failed").length;
	const passed = checks.filter((check) => check.status === "passed").length;
	const warned = checks.filter(
		(check) =>
			check.status === "passed" &&
			(check.warning || check.billingWarnings?.length),
	).length;
	return {
		passed: failed === 0 && passed === checks.length,
		checks,
		unsupportedToolChoices,
		unsupportedReasoningEfforts,
		summary:
			failed === 0 && passed === checks.length
				? `${passed} verification check${passed === 1 ? "" : "s"} passed${warned ? ` (${warned} with a warning)` : ""}.`
				: `${failed} of ${checks.length} verification checks failed.`,
	};
}

/**
 * One basic completion through the listing's own API format — enough to prove
 * a key authenticates and can call the model, without a full preflight.
 * Resolves to the failure message, or null when the key works.
 */
export async function runProviderKeySmokeTest(
	options: Omit<RunModelVerificationOptions, "onCheck">,
): Promise<string | null> {
	const outcome = await runCheck(
		{
			id: "basic",
			label: "Basic completion",
			request: createBasicVerificationRequest(options.target.modelName),
		},
		options,
		{
			secrets: new Set([options.token]),
			billingWarnings: new Set(),
			keyOnly: true,
		},
		[],
		() => undefined,
		() => undefined,
	);
	return outcome.failure?.message ?? null;
}

function verificationCredentialRowId(id: string): string {
	return `model-verification:${id}`;
}

// Admin-initiated runs belong to no carrier, so they get their own fixed
// encryption scope instead of a company id.
const ADMIN_VERIFICATION_SCOPE = "admin-verification";

function verificationCredentialScope(providerCompanyId: string | null): string {
	return providerCompanyId
		? `provider-company:${providerCompanyId}`
		: ADMIN_VERIFICATION_SCOPE;
}

export function encryptModelVerificationCredential(
	plaintext: string,
	id: string,
	providerCompanyId: string | null,
): string {
	return encryptProviderKey(
		plaintext,
		verificationCredentialRowId(id),
		verificationCredentialScope(providerCompanyId),
	);
}

export function decryptModelVerificationCredential(
	ciphertext: string,
	id: string,
	providerCompanyId: string | null,
): string {
	return decryptProviderKey(
		ciphertext,
		verificationCredentialRowId(id),
		verificationCredentialScope(providerCompanyId),
	);
}

// The carrier's saved verification key lives on the claim, so it is scoped to
// the claim row rather than to a single run.
function claimVerificationKeyRowId(claimId: string): string {
	return `provider-claim:${claimId}`;
}

export function encryptClaimVerificationKey(
	plaintext: string,
	claimId: string,
	providerCompanyId: string,
): string {
	return encryptProviderKey(
		plaintext,
		claimVerificationKeyRowId(claimId),
		verificationCredentialScope(providerCompanyId),
	);
}

export function decryptClaimVerificationKey(
	ciphertext: string,
	claimId: string,
	providerCompanyId: string,
): string {
	return decryptProviderKey(
		ciphertext,
		claimVerificationKeyRowId(claimId),
		verificationCredentialScope(providerCompanyId),
	);
}
