import { providers, type ProviderId } from "@llmgateway/models";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { redactToken } from "./provider-key/redact.js";
import { RED_IMAGE_DATA_URL } from "./verification-image.js";

import type { ModelVerificationRunResult } from "./model-verification.js";
import type {
	ProviderKeyOptions,
	ProviderModelVerificationCheck,
	ProviderModelVerificationProbe,
	ProviderModelVerificationTarget,
} from "@llmgateway/db";

/**
 * Preflight for Airside decision listings. A carrier's decision model is
 * served on its own OpenAI-compatible `POST /v1/decisions`, so the checks call
 * exactly that route and hold the response to the shape the gateway returns.
 */

export const DECISIONS_UPSTREAM_PATH = "/v1/decisions";

export type DecisionVerificationQuestion =
	| { type: "predicate"; name: string; instructions: string }
	| {
			type: "choice";
			name: string;
			instructions: string;
			choices: { value: string; description?: string }[];
	  }
	| {
			type: "score";
			name: string;
			instructions: string;
			levels: { label: string }[];
	  };

export interface DecisionVerificationRequest {
	model: string;
	input:
		| string
		| {
				role: "user";
				content: (
					| { type: "input_text"; text: string }
					| { type: "input_image"; image_url: string }
				)[];
		  }[];
	questions: DecisionVerificationQuestion[];
}

const INCIDENT_INPUT =
	"Our production checkout has returned 500 errors for every customer since 09:00.";

/**
 * One question per request: some decision models take a single question per
 * call, and the gateway forwards whatever the caller sends, so each type is
 * proven on its own.
 */
const TYPE_QUESTIONS: DecisionVerificationQuestion[] = [
	{
		type: "predicate",
		name: "is_outage",
		instructions: "Does this describe a production outage?",
	},
	{
		type: "choice",
		name: "team",
		instructions: "Which team should handle this?",
		choices: [
			{ value: "billing", description: "Charges and refunds" },
			{ value: "engineering", description: "Bugs and outages" },
		],
	},
	{
		type: "score",
		name: "severity",
		instructions: "How severe is this issue?",
		levels: [{ label: "Cosmetic" }, { label: "Minor" }, { label: "Critical" }],
	},
];

const VISION_QUESTION: DecisionVerificationQuestion = {
	type: "predicate",
	name: "is_red",
	instructions: "Is the image predominantly red?",
};

export function createDecisionVerificationRequests(
	externalId: string,
): DecisionVerificationRequest[] {
	return TYPE_QUESTIONS.map((question) => ({
		model: externalId,
		input: INCIDENT_INPUT,
		questions: [question],
	}));
}

export function createDecisionVisionVerificationRequest(
	externalId: string,
): DecisionVerificationRequest {
	return {
		model: externalId,
		input: [
			{
				role: "user",
				content: [
					{ type: "input_text", text: "Look at the attached image." },
					{ type: "input_image", image_url: RED_IMAGE_DATA_URL },
				],
			},
		],
		questions: [VISION_QUESTION],
	};
}

interface DecisionCheckDefinition {
	id: "basic" | "vision";
	label: string;
	requests: DecisionVerificationRequest[];
	/** Judges a well-formed response on what the model concluded. */
	judge?: (body: unknown) => string | null;
}

function decisionCheckDefinitions(
	target: ProviderModelVerificationTarget,
): DecisionCheckDefinition[] {
	const definitions: DecisionCheckDefinition[] = [
		{
			id: "basic",
			label: "Typed decisions",
			requests: createDecisionVerificationRequests(target.externalId),
		},
	];
	if (target.vision) {
		definitions.push({
			id: "vision",
			label: "Image input",
			requests: [createDecisionVisionVerificationRequest(target.externalId)],
			judge: visionDefect,
		});
	}
	return definitions;
}

export function createQueuedDecisionVerificationChecks(
	target: ProviderModelVerificationTarget,
): ProviderModelVerificationCheck[] {
	return decisionCheckDefinitions(target).map(({ id, label }) => ({
		id,
		label,
		status: "queued",
	}));
}

export interface RunDecisionVerificationOptions {
	target: ProviderModelVerificationTarget;
	token: string;
	baseUrl?: string;
	providerKeyOptions?: ProviderKeyOptions;
	skipEnvVars?: boolean;
	onCheck?: (check: ProviderModelVerificationCheck) => Promise<void> | void;
	fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
	return typeof value === "number" && value >= 0 && value <= 1;
}

function upstreamErrorMessage(body: string, status: number): string {
	try {
		const parsed = JSON.parse(body) as unknown;
		if (isRecord(parsed)) {
			const nested = isRecord(parsed.error) ? parsed.error.message : undefined;
			if (typeof nested === "string") {
				return `HTTP ${status}: ${nested.slice(0, 500)}`;
			}
			if (typeof parsed.message === "string") {
				return `HTTP ${status}: ${parsed.message.slice(0, 500)}`;
			}
			if (typeof parsed.detail === "string") {
				return `HTTP ${status}: ${parsed.detail.slice(0, 500)}`;
			}
		}
	} catch {
		// Fall through to the bounded plain-text response.
	}
	return `HTTP ${status}: ${body.trim().slice(0, 500) || "no response body"}`;
}

/** What is wrong with one answer, or null when it matches its question. */
export function decisionAnswerDefect(
	question: DecisionVerificationQuestion,
	answer: unknown,
): string | null {
	if (!isRecord(answer)) {
		return "Answer is not an object.";
	}
	if (answer.type === "refusal") {
		return `The model refused the ${question.type} question.`;
	}
	if (answer.type !== question.type) {
		return `Expected a ${question.type} answer, got ${JSON.stringify(answer.type)}.`;
	}
	if (answer.name !== question.name) {
		return `Answer does not echo the question name "${question.name}".`;
	}
	switch (question.type) {
		case "predicate":
			return isProbability(answer.probability)
				? null
				: "Predicate answer has no probability between 0 and 1.";
		case "choice": {
			const values = question.choices.map((choice) => choice.value);
			if (
				typeof answer.choice !== "string" ||
				!values.includes(answer.choice)
			) {
				return `Choice answer ${JSON.stringify(answer.choice)} is not one of the offered values.`;
			}
			if (
				!Array.isArray(answer.probabilities) ||
				answer.probabilities.length !== values.length
			) {
				return "Choice answer must carry one probability per offered value.";
			}
			return null;
		}
		case "score": {
			const maxLevel = question.levels.length - 1;
			if (
				typeof answer.score !== "number" ||
				answer.score < 0 ||
				answer.score > maxLevel
			) {
				return `Score answer must be a number from 0 to ${maxLevel}.`;
			}
			if (
				!Array.isArray(answer.probabilities) ||
				answer.probabilities.length !== question.levels.length
			) {
				return "Score answer must carry one probability per level.";
			}
			return null;
		}
	}
}

/** What is wrong with a `/v1/decisions` response body, or null. */
export function decisionResponseDefect(
	request: DecisionVerificationRequest,
	body: unknown,
): string | null {
	if (!isRecord(body) || !Array.isArray(body.answers)) {
		return "Response has no answers array.";
	}
	if (body.answers.length !== request.questions.length) {
		return `Expected ${request.questions.length} answer(s), got ${body.answers.length}.`;
	}
	for (const [index, question] of request.questions.entries()) {
		const defect = decisionAnswerDefect(question, body.answers[index]);
		if (defect) {
			return defect;
		}
	}
	const usage = isRecord(body.usage) ? body.usage : undefined;
	const inputTokens = usage?.input_tokens;
	if (
		typeof inputTokens !== "number" ||
		!Number.isInteger(inputTokens) ||
		inputTokens <= 0
	) {
		return "Response must report usage.input_tokens; decisions are billed on input tokens.";
	}
	return null;
}

/**
 * The vision probe is a solid red image: a model that reads it answers "is it
 * red" well above even odds, and one that ignores the image cannot tell.
 */
function visionDefect(body: unknown): string | null {
	const answers =
		isRecord(body) && Array.isArray(body.answers) ? body.answers : [];
	const [answer] = answers as unknown[];
	const probability = isRecord(answer) ? answer.probability : undefined;
	return typeof probability === "number" && probability >= 0.5
		? null
		: `The model answered ${JSON.stringify(probability)} for a solid red image being red; it does not appear to read input_image parts.`;
}

const CHECK_TIMEOUT_ATTEMPTS = 3;

function decisionsEndpoint(options: RunDecisionVerificationOptions): {
	url: string;
	provider: ProviderId;
} {
	const knownProvider = providers.some(
		(provider) => provider.id === options.target.providerId,
	);
	const provider = (
		knownProvider ? options.target.providerId : "custom"
	) as ProviderId;
	const baseUrl =
		options.baseUrl ??
		(knownProvider ? getProviderDefaultBaseUrl(provider) : undefined);
	if (!baseUrl) {
		throw new Error(
			`Provider ${options.target.providerId} has no registered endpoint.`,
		);
	}
	let root = baseUrl;
	while (root.endsWith("/")) {
		root = root.slice(0, -1);
	}
	return { url: `${root}${DECISIONS_UPSTREAM_PATH}`, provider };
}

async function sendDecisionRequest(
	request: DecisionVerificationRequest,
	options: RunDecisionVerificationOptions,
	judge?: (body: unknown) => string | null,
): Promise<string | null> {
	for (let attempt = 1; ; attempt++) {
		try {
			const { url, provider } = decisionsEndpoint(options);
			if (options.baseUrl) {
				await assertSafeProviderUrl(options.baseUrl);
			}
			const response = await (options.fetchImplementation ?? fetch)(url, {
				method: "POST",
				redirect: "error",
				headers: {
					"Content-Type": "application/json",
					...getProviderHeaders(provider, options.token, {
						providerKeyOptions: options.providerKeyOptions,
						skipEnvVars: options.skipEnvVars,
					}),
				},
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(120_000),
			});
			const text = await response.text();
			if (!response.ok) {
				return response.status === 404
					? `${upstreamErrorMessage(text, response.status)}. Decision models must be served on POST ${DECISIONS_UPSTREAM_PATH}.`
					: upstreamErrorMessage(text, response.status);
			}
			let body: unknown;
			try {
				body = JSON.parse(text);
			} catch {
				return "Response is not JSON.";
			}
			return decisionResponseDefect(request, body) ?? judge?.(body) ?? null;
		} catch (error) {
			const timedOut = error instanceof Error && error.name === "TimeoutError";
			if (timedOut && attempt < CHECK_TIMEOUT_ATTEMPTS) {
				continue;
			}
			const message =
				error instanceof Error ? error.message : "Verification request failed.";
			return timedOut
				? `${message} (timed out on all ${CHECK_TIMEOUT_ATTEMPTS} attempts)`
				: message;
		}
	}
}

function probeLabel(request: DecisionVerificationRequest): string {
	const question = request.questions[0];
	return Array.isArray(request.input)
		? `${question.type} with input_image`
		: question.type;
}

async function runDecisionCheck(
	definition: DecisionCheckDefinition,
	options: RunDecisionVerificationOptions,
): Promise<{
	failure: string | null;
	probes: ProviderModelVerificationProbe[];
}> {
	const probes: ProviderModelVerificationProbe[] = [];
	let failure: string | null = null;
	for (const request of definition.requests) {
		const defect = await sendDecisionRequest(
			request,
			options,
			definition.judge,
		);
		probes.push(
			defect
				? {
						label: probeLabel(request),
						status: "failed",
						feedback: redactToken(defect, options.token),
					}
				: { label: probeLabel(request), status: "passed" },
		);
		failure ??= defect ? redactToken(defect, options.token) : null;
	}
	return { failure, probes };
}

export async function runDecisionVerification(
	options: RunDecisionVerificationOptions,
): Promise<ModelVerificationRunResult> {
	const definitions = decisionCheckDefinitions(options.target);
	const checks = createQueuedDecisionVerificationChecks(options.target);
	for (const [index, definition] of definitions.entries()) {
		const running: ProviderModelVerificationCheck = {
			id: definition.id,
			label: definition.label,
			status: "running",
		};
		checks[index] = running;
		await options.onCheck?.(running);
		const { failure, probes } = await runDecisionCheck(definition, options);
		const completed: ProviderModelVerificationCheck = failure
			? {
					id: definition.id,
					label: definition.label,
					status: "failed",
					feedback: failure,
					probes,
				}
			: {
					id: definition.id,
					label: definition.label,
					status: "passed",
					feedback: "Passed",
					probes,
				};
		checks[index] = completed;
		await options.onCheck?.(completed);
		if (definition.id === "basic" && failure) {
			for (const [rest, skippedDefinition] of definitions.entries()) {
				if (rest <= index) {
					continue;
				}
				const skipped: ProviderModelVerificationCheck = {
					id: skippedDefinition.id,
					label: skippedDefinition.label,
					status: "skipped",
					feedback: "Skipped because the typed decisions check failed.",
				};
				checks[rest] = skipped;
				await options.onCheck?.(skipped);
			}
			break;
		}
	}
	const failed = checks.filter((check) => check.status === "failed").length;
	const passed = checks.filter((check) => check.status === "passed").length;
	const allPassed = failed === 0 && passed === checks.length;
	return {
		passed: allPassed,
		checks,
		summary: allPassed
			? `${passed} verification check${passed === 1 ? "" : "s"} passed.`
			: `${failed} of ${checks.length} verification checks failed.`,
	};
}

/** One predicate decision: enough to prove a key reaches the model. */
export async function runDecisionKeySmokeTest(
	options: Omit<RunDecisionVerificationOptions, "onCheck">,
): Promise<string | null> {
	const [request] = createDecisionVerificationRequests(
		options.target.externalId,
	);
	const defect = await sendDecisionRequest(request, options);
	return defect ? redactToken(defect, options.token) : null;
}
