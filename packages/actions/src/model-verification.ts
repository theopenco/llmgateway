import {
	type BaseMessage,
	type OpenAIRequestBody,
	type OpenAIToolInput,
	type ProviderId,
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
	decryptProviderKey,
	encryptProviderKey,
} from "./provider-key/crypto.js";
import { redactToken } from "./provider-key/redact.js";

import type {
	ProviderKeyOptions,
	ProviderModelVerificationCheck,
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
	reasoning_effort?:
		"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
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
}

const RED_PIXEL_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7h8AAAAASUVORK5CYII=";

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
						image_url: { url: RED_PIXEL_DATA_URL },
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

export function createToolVerificationRequest(
	model: string,
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
					name: "get_weather",
					description: "Get the current weather for a city",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
		],
		tool_choice: "required",
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

function preferredReasoningEffort(
	target: ProviderModelVerificationTarget,
): ModelVerificationRequest["reasoning_effort"] {
	const supported = target.reasoningEfforts ?? [];
	if (supported.length === 0 || supported.includes("medium")) {
		return "medium";
	}
	for (const effort of ["high", "low", "minimal", "xhigh", "max"] as const) {
		if (supported.includes(effort)) {
			return effort;
		}
	}
	return "medium";
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
			request: createToolVerificationRequest(target.modelName),
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
	if (target.reasoning) {
		definitions.push({
			id: "reasoning",
			label: "Reasoning",
			request: createReasoningVerificationRequest(
				target.modelName,
				preferredReasoningEffort(target),
			),
		});
	}
	if (target.reasoningMaxTokens) {
		definitions.push({
			id: "reasoning_budget",
			label: "Reasoning budget",
			request: createReasoningVerificationRequest(target.modelName),
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

function containsWebSearchEvidence(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(containsWebSearchEvidence);
	}
	if (!isRecord(value)) {
		return false;
	}
	if (
		typeof value.type === "string" &&
		(value.type.includes("web_search") || value.type.includes("search_result"))
	) {
		return true;
	}
	return Object.entries(value).some(([key, entry]) => {
		if (
			[
				"annotations",
				"citations",
				"groundingMetadata",
				"search_results",
				"web_search_call",
			].includes(key) &&
			((Array.isArray(entry) && entry.length > 0) || isRecord(entry))
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

async function runCheck(
	definition: ModelVerificationDefinition,
	options: RunModelVerificationOptions,
): Promise<string | null> {
	const knownProvider = providers.some(
		(provider) => provider.id === options.target.providerId,
	);
	if (!knownProvider && !options.baseUrl) {
		return `Provider ${options.target.providerId} has no registered endpoint.`;
	}
	if (options.baseUrl) {
		await assertSafeProviderUrl(options.baseUrl);
	}
	const provider = (
		knownProvider ? options.target.providerId : "custom"
	) as ProviderId;
	let requestToken = options.token;
	if (
		provider === "vertex-anthropic" ||
		provider === "vertex-openai" ||
		(provider === "google-vertex" && options.token.trim().startsWith("{"))
	) {
		requestToken = await getGcpServiceAccountAccessToken(options.token);
	}
	const endpoint = getProviderEndpoint(
		provider,
		options.baseUrl,
		options.target.externalId,
		isGoogleQueryTokenProvider(provider) ? requestToken : undefined,
		definition.request.stream ?? false,
		options.target.reasoning,
		false,
		options.providerKeyOptions,
		undefined,
		false,
		undefined,
		options.skipEnvVars,
		options.target.modelName,
	);
	const useResponsesApi = endpoint.includes("/responses");
	const { functionTools, webSearchTool } = splitTools(definition.request.tools);
	const payload = await prepareRequestBody(
		provider,
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
	const headers = getProviderHeaders(provider, requestToken, {
		providerKeyOptions: options.providerKeyOptions,
		skipEnvVars: options.skipEnvVars,
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
		return redactToken(
			upstreamErrorMessage(bodyText, response.status),
			options.token,
		);
	}
	if (definition.request.stream) {
		return validateStream(bodyText);
	}
	let body: unknown;
	try {
		body = JSON.parse(bodyText) as unknown;
	} catch {
		return "The provider returned a non-JSON response.";
	}
	return validateResponse(definition.id, body);
}

export async function runProviderModelVerification(
	options: RunModelVerificationOptions,
): Promise<ModelVerificationRunResult> {
	const definitions = verificationDefinitions(options.target);
	const checks = createQueuedModelVerificationChecks(options.target);
	for (let index = 0; index < definitions.length; index++) {
		const definition = definitions[index];
		const running: ProviderModelVerificationCheck = {
			id: definition.id,
			label: definition.label,
			status: "running",
		};
		checks[index] = running;
		await options.onCheck?.(running);
		let failure: string | null;
		try {
			failure = await runCheck(definition, options);
		} catch (error) {
			failure = redactToken(
				(error instanceof Error
					? error.message
					: "Verification request failed."
				).slice(0, 500),
				options.token,
			);
		}
		const completed: ProviderModelVerificationCheck = failure
			? {
					id: definition.id,
					label: definition.label,
					status: "failed",
					feedback: failure,
				}
			: {
					id: definition.id,
					label: definition.label,
					status: "passed",
					feedback: "Passed",
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
		summary:
			failed === 0 && passed === checks.length
				? `${passed} verification check${passed === 1 ? "" : "s"} passed.`
				: `${failed} of ${checks.length} verification checks failed.`,
	};
}

function verificationCredentialRowId(id: string): string {
	return `model-verification:${id}`;
}

function verificationCredentialScope(providerCompanyId: string): string {
	return `provider-company:${providerCompanyId}`;
}

export function encryptModelVerificationCredential(
	plaintext: string,
	id: string,
	providerCompanyId: string,
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
	providerCompanyId: string,
): string {
	return decryptProviderKey(
		ciphertext,
		verificationCredentialRowId(id),
		verificationCredentialScope(providerCompanyId),
	);
}
