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
import { getProviderApiTransport } from "./provider-api-format.js";
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
	| "web_search";

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

function validateResponse(
	id: ModelVerificationCheckId,
	body: unknown,
): string | null {
	const assistantText = extractAssistantText(body);
	switch (id) {
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

function validateStream(body: string): string | null {
	const events = body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trim())
		.filter((data) => data && data !== "[DONE]");
	return events.length > 0
		? null
		: "The response did not contain any streaming events.";
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
		"iceberg",
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
}

async function attemptCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	secrets: Set<string>,
): Promise<CheckFailure | null> {
	try {
		return await executeCheck(definition, options, secrets);
	} catch (error) {
		return {
			message: redactSecrets(
				(error instanceof Error
					? error.message
					: "Verification request failed."
				).slice(0, 500),
				secrets,
			),
			rejected: false,
		};
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
	secrets: Set<string>,
	knownUnsupported: ReasoningEffort[],
	reportProbes: ProbeReporter,
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
			secrets,
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

async function runCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	secrets: Set<string>,
	knownUnsupportedReasoningEfforts: ReasoningEffort[],
	reportProbes: ProbeReporter,
): Promise<CheckOutcome> {
	if (definition.id === "reasoning" || definition.id === "reasoning_budget") {
		return await runReasoningCheck(
			definition,
			options,
			secrets,
			knownUnsupportedReasoningEfforts,
			reportProbes,
		);
	}
	if (definition.id !== "tools") {
		return { failure: await attemptCheck(definition, options, secrets) };
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
			secrets,
		);
		probes.push(probeResult(`tool_choice: ${mode}`, failure));
		await reportProbes(probes);
		if (!failure) {
			return { failure: null, unsupportedToolChoices, probes };
		}
		unsupportedToolChoices.push(mode);
	}
	return { failure, probes };
}

async function executeCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
	secrets: Set<string>,
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
	secrets.add(requestToken);
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
		options.target.externalId,
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
			definition.id === "web_search" ? 300_000 : 120_000,
		),
	});
	const bodyText = await response.text();
	if (!response.ok) {
		return {
			message: redactSecrets(
				upstreamErrorMessage(bodyText, response.status),
				secrets,
			),
			rejected: response.status >= 400 && response.status < 500,
		};
	}
	const served = definition.request.stream
		? validateStream(bodyText)
		: validateServedResponse(definition.id, bodyText);
	return served ? { message: served, rejected: false } : null;
}

function validateServedResponse(
	id: ModelVerificationCheckId,
	bodyText: string,
): string | null {
	let body: unknown;
	try {
		body = JSON.parse(bodyText) as unknown;
	} catch {
		return "The provider returned a non-JSON response.";
	}
	return validateResponse(id, body);
}

export async function runProviderModelVerification(
	options: RunModelVerificationOptions,
): Promise<ModelVerificationRunResult> {
	const definitions = verificationDefinitions(options.target);
	const checks = createQueuedModelVerificationChecks(options.target);
	const secrets = new Set([options.token]);
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
		const outcome = await runCheck(
			definition,
			options,
			secrets,
			unsupportedReasoningEfforts ?? [],
			async (probes) => {
				const progress: ProviderModelVerificationCheck = {
					...running,
					probes: [...probes],
				};
				checks[index] = progress;
				await options.onCheck?.(progress);
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
					...(outcome.probes?.length ? { probes: outcome.probes } : {}),
				};
		checks[index] = completed;
		await options.onCheck?.(completed);
		if (definition.id === "basic" && failure) {
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
	return {
		passed: failed === 0 && passed === checks.length,
		checks,
		unsupportedToolChoices,
		unsupportedReasoningEfforts,
		summary:
			failed === 0 && passed === checks.length
				? `${passed} verification check${passed === 1 ? "" : "s"} passed.`
				: `${failed} of ${checks.length} verification checks failed.`,
	};
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
