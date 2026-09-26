import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { buildRoutingAttempt } from "@/chat/tools/build-routing-attempt.js";
import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getFinishReasonFromError } from "@/chat/tools/get-finish-reason-from-error.js";
import {
	getCredentialSetting,
	resolvePlatformCredential,
} from "@/chat/tools/resolve-platform-credential.js";
import { getAvailableCredits } from "@/chat/tools/resolve-provider-context.js";
import {
	getErrorType,
	isRetryableErrorType,
	shouldRetryAlternateKey,
} from "@/chat/tools/retry-with-fallback.js";
import { validateSource } from "@/chat/tools/validate-source.js";
import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";
import {
	assertApiKeyWithinUsageLimits,
	assertMemberProjectAccess,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { raceClientAbort } from "@/lib/client-abort.js";
import {
	assertProviderCompliant,
	getEffectiveRetentionLevel,
} from "@/lib/compliance.js";
import {
	applyEndUserSession,
	assertTestWalletModelAllowed,
} from "@/lib/end-user-session.js";
import { getLicensedOrganizationEnvVariant } from "@/lib/enterprise.js";
import {
	rateLimitHeaders,
	standardErrorResponses,
} from "@/lib/error-schemas.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { fetchProvider } from "@/lib/fetch-provider.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { assertOrganizationUsable } from "@/lib/organization-access.js";
import { assertSpendLimit } from "@/lib/spend-limit.js";
import {
	clientFacingUpstreamFailureMessage,
	redactedProviderErrorText,
	shouldRedactProviderError,
} from "@/lib/stealth-provider-errors.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";
import { validateModelOutput } from "@/lib/validate-model-output.js";

import {
	getProviderDefaultBaseUrl,
	getProviderHeaders,
	providerKeyLabel,
	readProviderKey,
} from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import { models as modelDefinitions, type Provider } from "@llmgateway/models";
import { getClientIpFromRequest } from "@llmgateway/shared/client-ip";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";
import type { RoutingCredentialSource } from "@llmgateway/shared/routing-telemetry";
import type { Context } from "hono";

/** Free-form text, or JSON structure the questions can reference by key. */
const structuredTextSchema = z.union([
	z.string(),
	z.record(z.unknown()),
	z.array(z.unknown()),
]);

const instructionsSchema = structuredTextSchema.openapi({
	description:
		"What the model should decide. An object or array can hold the question in one field and the data it refers to in others.",
	example: "Does this message convey urgency?",
});

const noulQuestionSchema = z.object({
	type: z.literal("noul"),
	instructions: instructionsSchema,
	criteria: z
		.object({
			true: structuredTextSchema.optional(),
			false: structuredTextSchema.optional(),
		})
		.optional()
		.openapi({
			description: "Optional descriptions of what a yes and a no mean.",
		}),
});

const choiceQuestionSchema = z.object({
	type: z.literal("choice"),
	instructions: instructionsSchema,
	criteria: z
		.record(structuredTextSchema.nullable())
		.refine((criteria) => Object.keys(criteria).length >= 2, {
			message: "A choice question needs at least two options",
		})
		.refine((criteria) => Object.keys(criteria).length <= 255, {
			message: "A choice question accepts at most 255 options",
		})
		.openapi({
			description:
				"Option to rubric description. Use null for an option that needs no detail.",
		}),
});

const scoreQuestionSchema = z.object({
	type: z.literal("score"),
	instructions: instructionsSchema,
	criteria: z.array(structuredTextSchema).min(2).max(10).openapi({
		description: "Ordered level descriptions, lowest first. Two to ten levels.",
	}),
});

const questionSchema = z
	.discriminatedUnion("type", [
		noulQuestionSchema,
		choiceQuestionSchema,
		scoreQuestionSchema,
	])
	.openapi({
		description:
			"A typed question: `noul` (yes/no probability), `choice` (one option from a set) or `score` (rating across ordered levels).",
	});

const systemOneRequestSchema = z.object({
	model: z.string().openapi({
		description:
			"ID of the decision model to use. Optionally prefixed with a provider (`typesafe/…`).",
		example: "jev-1.13.0",
	}),
	state: structuredTextSchema.openapi({
		description:
			"The content to evaluate: plain text, or structured data such as a chat log or record.",
		example: "Our production integration has been returning 500s for 3 days.",
	}),
	questions: z
		.record(questionSchema)
		.refine((questions) => Object.keys(questions).length > 0, {
			message: "At least one question is required",
		})
		.openapi({
			description:
				"Questions keyed by an id you choose. Answers come back under the same ids.",
		}),
});

const systemOneAnswerSchema = z
	.object({
		type: z.enum(["noul", "choice", "score"]),
		noul: z.number().optional().openapi({
			description: "Yes/no answer from 0 (no) to 1 (yes), on a noul answer.",
		}),
		choice: z.string().optional().openapi({
			description: "Highest-probability option, on a choice answer.",
		}),
		score: z.number().optional().openapi({
			description:
				"Probability-weighted level, on a score answer. Can land between levels.",
		}),
		legend: z.record(z.string()).optional().openapi({
			description: "Level index to its description, on a score answer.",
		}),
		probabilities: z.record(z.number()).optional().openapi({
			description: "Probability per option or level; sums to 1.",
		}),
		confidence: z.number().optional().openapi({
			description:
				"How certain the model is, derived from the probability distribution.",
		}),
	})
	.passthrough();

const systemOneResponseSchema = z
	.object({
		model: z.string(),
		answers: z.record(systemOneAnswerSchema),
		usage: z
			.object({
				input_tokens: z.number().int().optional(),
				output_tokens: z.number().int().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough()
	.openapi({
		description: "One typed answer per question, keyed by the question ids.",
	});

function findDecisionMapping(modelId: string): {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
	explicitProvider: boolean;
} | null {
	let requestedProvider: string | undefined;
	let modelKey = modelId;
	const slashIdx = modelId.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = modelId.slice(0, slashIdx);
		modelKey = modelId.slice(slashIdx + 1);
	}
	for (const model of modelDefinitions as ModelDefinition[]) {
		// The provider's own moving aliases (`jev-latest`) resolve to the pinned
		// catalogue entry, so a request is always billed and logged against the
		// version we have prices for.
		if (model.id !== modelKey && !model.aliases?.includes(modelKey)) {
			continue;
		}
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (!candidate.decisions) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			return {
				mapping: candidate,
				modelDef: model,
				modelDefId: model.id,
				explicitProvider: requestedProvider !== undefined,
			};
		}
	}
	return null;
}

async function assertCreditsAvailableForSystemOne(
	c: Context,
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
) {
	await assertSpendLimit(c, organization, modelDef.free === true);

	const { totalAvailableCredits } = getAvailableCredits(organization);

	if (totalAvailableCredits > 0 || modelDef.free) {
		return;
	}

	throw new HTTPException(402, { message: insufficientCreditsMessage });
}

/** Question ids and types, as a one-line summary for the request log. */
function summarizeQuestions(
	questions: Record<string, z.infer<typeof questionSchema>>,
): string {
	return Object.entries(questions)
		.map(([id, question]) => `${id} (${question.type})`)
		.join(", ");
}

function summarizeState(state: unknown): string {
	const text = typeof state === "string" ? state : JSON.stringify(state);
	return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

export const systemone = new OpenAPIHono<ServerTypes>();

const createSystemOne = createRoute({
	operationId: "v1_systemone",
	summary: "System One",
	description:
		"Evaluate a state against named typed questions and get calibrated yes/no, choice and score answers back. TypeSafe-compatible API.",
	method: "post",
	path: "/",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: systemOneRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			headers: rateLimitHeaders,
			content: {
				"application/json": {
					schema: systemOneResponseSchema,
				},
			},
			description: "Typed answers for the submitted questions.",
		},
		...standardErrorResponses(),
	},
});

systemone.openapi(createSystemOne, async (c): Promise<any> => {
	const startedAt = Date.now();
	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);
	c.header("x-request-id", requestId);

	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return c.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
					param: null,
					code: "invalid_json",
				},
			},
			400,
		);
	}

	const validationResult = systemOneRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		return c.json(
			{
				error: {
					message: `Invalid request parameters: ${validationResult.error.issues[0]?.message ?? "unknown"}`,
					type: "invalid_request_error",
					param: validationResult.error.issues[0]?.path.join(".") ?? null,
					code: "invalid_parameters",
				},
			},
			400,
		);
	}

	const { model: requestedModel, state, questions } = validationResult.data;

	const source = validateSource(
		c.req.header("x-source"),
		c.req.header("HTTP-Referer"),
	);
	const userAgent = c.req.header("User-Agent") ?? undefined;
	const debugMode =
		c.req.header("x-debug") === "true" ||
		process.env.FORCE_DEBUG_MODE === "true" ||
		process.env.NODE_ENV !== "production";
	const customHeaders = extractCustomHeaders(c);

	const token = extractApiToken(c);
	const apiKey = await findApiKeyByToken(token);

	if (!apiKey) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. The token could not be found. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: This LLMGateway API token is not active (it may be disabled or deleted). Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	const baseProject = await findProjectById(apiKey.projectId);
	if (!baseProject) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	if (baseProject.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	await assertMemberProjectAccess(apiKey, baseProject.organizationId);
	await assertMemberWithinBudget(apiKey.createdBy, baseProject.organizationId);
	assertApiKeyWithinUsageLimits(apiKey);

	const baseOrganization = await findOrganizationById(
		baseProject.organizationId,
	);
	if (!baseOrganization) {
		throw new HTTPException(500, {
			message: "Could not find organization",
		});
	}

	assertOrganizationUsable(baseOrganization);

	const { project, organization, wallet } = await applyEndUserSession(
		c,
		apiKey,
		baseProject,
		baseOrganization,
	);

	const retentionLevel = getEffectiveRetentionLevel(organization);

	const result = findDecisionMapping(requestedModel);
	if (!result) {
		return c.json(
			{
				error: {
					message: `Model ${requestedModel} not found or is not a decision model`,
					type: "invalid_request_error",
					param: null,
					code: "model_not_found",
				},
			},
			400,
		);
	}

	const {
		mapping: decisionMapping,
		modelDef,
		modelDefId,
		explicitProvider,
	} = result;
	const providerId = decisionMapping.providerId;
	const upstreamModel = decisionMapping.externalId;
	const responseModel = formatUsedModelForDisplay(
		providerId,
		modelDefId,
		undefined,
		decisionMapping.region,
	);

	validateModelOutput(modelDef, requestedModel, ["decision"]);

	assertTestWalletModelAllowed(wallet, modelDef);

	if (organization.kind === "devpass" && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"Typed decisions are not available for coding plans. Coding plans only include text-based inference.",
		});
	}

	const iamValidation = await validateRequestModelAccess({
		apiKey,
		organizationId: project.organizationId,
		requestedModel: modelDefId,
		requestedProvider: providerId,
		activeModelInfo: modelDef,
		clientIp: getClientIpFromRequest(c),
	});
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}

	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: modelDefId,
		apiKeyId: apiKey.id,
		model: requestedModel,
	});

	const failedKeys = createFailedKeyTracker();
	const routingAttempts: RoutingAttempt[] = [];
	const finalLogId = shortid();

	const buildSystemOneRoutingMetadata = (
		usedApiKeyHash: string | undefined,
		usedCredentialSource: RoutingCredentialSource,
		usedProviderKey: { id?: string; label?: string },
	): RoutingMetadata => ({
		availableProviders: [providerId],
		selectedProvider: providerId,
		selectionReason: explicitProvider
			? "direct-provider-specified"
			: "single-provider-available",
		...(usedApiKeyHash
			? {
					usedApiKeyHash,
					usedCredentialSource,
					usedProviderKeyId: usedProviderKey.id,
					usedProviderKeyLabel: usedProviderKey.label,
				}
			: {}),
		providerScores: [],
		...(routingAttempts.length > 0 ? { routing: routingAttempts } : {}),
	});

	interface SystemOneAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		/** Platform-managed credential when one served this attempt. */
		managedKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
		requestBody: Record<string, unknown>;
	}

	async function resolveAttempt(): Promise<SystemOneAttempt> {
		let providerKeyInner:
			InferSelectModel<typeof tables.providerKey> | undefined;
		let managedKeyInner:
			InferSelectModel<typeof tables.providerKey> | undefined;
		let usedToken: string | undefined;
		let configIndex = 0;
		let envVarName: string | undefined;
		const envVariant = getLicensedOrganizationEnvVariant(organization);

		const excludedProviderKeyIds = failedKeys.providerKeyIdsFor(
			providerId,
			undefined,
		);
		const excludedEnvKeyIndices = failedKeys.envKeyIndicesFor(
			providerId,
			undefined,
		);

		const resolveCredits = async () => {
			const platformCredential = await resolvePlatformCredential(
				providerId as Provider,
				{
					selectionScope: upstreamModel,
					variant: envVariant,
					region: undefined,
					requiresServiceTier: false,
					excludedEnvIndices: excludedEnvKeyIndices,
					excludedProviderKeyIds,
				},
			);
			managedKeyInner = platformCredential.managedKey;
			usedToken = platformCredential.token;
			configIndex = platformCredential.configIndex;
			envVarName = platformCredential.envVarName;
		};

		if (project.mode === "api-keys") {
			providerKeyInner = await findProviderKey(
				project.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (!providerKeyInner) {
				throw new HTTPException(400, {
					message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
				});
			}
			usedToken = readProviderKey(providerKeyInner);
		} else if (project.mode === "credits") {
			await assertCreditsAvailableForSystemOne(
				c,
				organization,
				modelDef,
				`Organization ${organization.id} has insufficient credits`,
			);

			await resolveCredits();
		} else if (project.mode === "hybrid") {
			providerKeyInner = await findProviderKey(
				project.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (providerKeyInner) {
				usedToken = readProviderKey(providerKeyInner);
			} else {
				await assertCreditsAvailableForSystemOne(
					c,
					organization,
					modelDef,
					"No API key set for provider and organization has insufficient credits",
				);

				await resolveCredits();
			}
		} else {
			throw new HTTPException(400, {
				message: `Invalid project mode: ${project.mode}`,
			});
		}

		if (!usedToken) {
			throw new HTTPException(500, {
				message: "No token",
			});
		}

		const resolvedBaseUrl =
			providerKeyInner?.baseUrl ??
			getCredentialSetting(
				providerId as Provider,
				"baseUrl",
				{ providerKey: providerKeyInner, managedKey: managedKeyInner },
				{ configIndex, variant: envVariant },
			) ??
			getProviderDefaultBaseUrl(providerId);
		if (!resolvedBaseUrl) {
			throw new HTTPException(500, {
				message: `No base URL set for provider: ${providerId}`,
			});
		}

		return {
			providerKey: providerKeyInner,
			managedKey: managedKeyInner,
			usedToken,
			configIndex,
			envVarName,
			upstreamUrl: `${resolvedBaseUrl.replace(/\/+$/, "")}/v1/systemone`,
			requestBody: {
				model: upstreamModel,
				state,
				questions,
			},
		};
	}

	async function resolveNextAttempt(
		failedAttempt: SystemOneAttempt,
	): Promise<SystemOneAttempt | null> {
		failedKeys.remember(providerId, undefined, {
			envVarName: failedAttempt.envVarName,
			configIndex: failedAttempt.configIndex,
			providerKeyId:
				failedAttempt.providerKey?.id ?? failedAttempt.managedKey?.id,
		});
		try {
			const next = await resolveAttempt();
			if (
				next.usedToken === failedAttempt.usedToken &&
				next.envVarName === failedAttempt.envVarName &&
				next.configIndex === failedAttempt.configIndex &&
				next.providerKey?.id === failedAttempt.providerKey?.id &&
				next.managedKey?.id === failedAttempt.managedKey?.id
			) {
				return null;
			}
			return next;
		} catch {
			return null;
		}
	}

	let attempt: SystemOneAttempt = await resolveAttempt();

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	try {
		while (true) {
			const attemptLogId = shortid();
			const usedApiKeyHash = getApiKeyFingerprint(attempt.usedToken);
			const credentialSource: RoutingCredentialSource = attempt.providerKey
				? "byok"
				: "platform";
			const providerKeyId = attempt.providerKey?.id;
			const keyLabel = providerKeyLabel(attempt.providerKey);
			const usedProviderKey = { id: providerKeyId, label: keyLabel };
			const baseLogEntry = createLogEntry({
				requestId,
				project,
				apiKey,
				organizationProviderKeyId: attempt.providerKey?.id,
				usedProviderKeyId: attempt.providerKey?.id ?? attempt.managedKey?.id,
				usedModel: `${providerId}/${modelDefId}`,
				usedModelMapping: upstreamModel,
				usedProvider: providerId,
				requestedModel,
				requestedProvider: providerId,
				messages: [
					{
						role: "user",
						content: `state: ${summarizeState(state)}\nquestions: ${summarizeQuestions(questions)}`,
					},
				],
				source,
				apiOrigin: "systemone",
				customHeaders,
				debugMode,
				userAgent,
				rawRequest: rawBody,
				upstreamRequest: attempt.requestBody,
			});

			let upstreamResponse: Response;
			let upstreamText = "";
			let fetchError: Error | null = null;
			try {
				const fetchSignal = createCombinedSignal(controller);
				upstreamResponse = await fetchProvider(attempt.upstreamUrl, {
					method: "POST",
					// SSRF: never follow redirects on an authenticated provider request.
					redirect: "error",
					headers: {
						"Content-Type": "application/json",
						...getProviderHeaders(providerId, attempt.usedToken, {
							requestId,
						}),
					},
					body: JSON.stringify(attempt.requestBody),
					signal: fetchSignal,
				});
				upstreamText = await raceClientAbort(
					upstreamResponse.text(),
					c.req.raw.signal,
					controller,
				);
			} catch (error) {
				const isCanceled =
					error instanceof Error &&
					(error.name === "AbortError" || c.req.raw.signal.aborted);
				const isTimeout = isTimeoutError(error);
				const isNetworkError = error instanceof TypeError;
				if (!isCanceled && !isTimeout && !isNetworkError) {
					throw error;
				}
				fetchError = error instanceof Error ? error : new Error(String(error));
				upstreamResponse = undefined as unknown as Response;
			}

			if (fetchError !== null) {
				const isCanceled =
					fetchError.name === "AbortError" || c.req.raw.signal.aborted;
				const isTimeout = isTimeoutError(fetchError);

				const duration = Date.now() - startedAt;
				// A client hanging up says nothing about the credential, and three
				// of them in a row would otherwise cool a perfectly healthy key.
				if (!isCanceled && attempt.envVarName !== undefined) {
					reportKeyError(
						attempt.envVarName,
						attempt.configIndex,
						0,
						undefined,
						upstreamModel,
					);
				}
				const failedTrackedKeyId =
					attempt.providerKey?.id ?? attempt.managedKey?.id;
				if (!isCanceled && failedTrackedKeyId) {
					reportTrackedKeyError(
						failedTrackedKeyId,
						0,
						undefined,
						upstreamModel,
					);
				}

				const networkErrorType = isTimeout
					? "upstream_timeout"
					: "network_error";
				const nextAttempt =
					!isCanceled && isRetryableErrorType(networkErrorType)
						? await resolveNextAttempt(attempt)
						: null;
				const willRetry = nextAttempt !== null;

				if (!isCanceled) {
					routingAttempts.push(
						buildRoutingAttempt(
							providerId,
							modelDefId,
							0,
							networkErrorType,
							false,
							{
								apiKeyHash: usedApiKeyHash,
								credentialSource,
								providerKeyId,
								providerKeyLabel: keyLabel,
								logId: willRetry ? attemptLogId : finalLogId,
							},
						),
					);
				}

				await insertLog(
					{
						...baseLogEntry,
						id: willRetry ? attemptLogId : finalLogId,
						routingMetadata: buildSystemOneRoutingMetadata(
							usedApiKeyHash,
							credentialSource,
							usedProviderKey,
						),
						duration,
						timeToFirstToken: null,
						timeToFirstReasoningToken: null,
						responseSize: 0,
						content: null,
						reasoningContent: null,
						finishReason: isCanceled ? "canceled" : "upstream_error",
						promptTokens: null,
						completionTokens: null,
						totalTokens: null,
						reasoningTokens: null,
						cachedTokens: null,
						hasError: !isCanceled,
						streamed: false,
						canceled: isCanceled,
						errorDetails: isCanceled
							? null
							: {
									statusCode: 0,
									statusText: fetchError.name,
									responseText: fetchError.message,
								},
						inputCost: 0,
						outputCost: 0,
						cachedInputCost: 0,
						requestCost: 0,
						webSearchCost: 0,
						imageInputTokens: null,
						imageOutputTokens: null,
						imageInputCost: null,
						imageOutputCost: null,
						cost: 0,
						estimatedCost: false,
						discount: null,
						pricingTier: null,
						dataStorageCost: calculateDataStorageCost(
							null,
							null,
							null,
							null,
							retentionLevel,
						),
						cached: false,
						toolResults: null,
						retried: willRetry,
						retriedByLogId: willRetry ? finalLogId : null,
					},
					{ retentionLevel },
				);

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

				if (isCanceled) {
					return c.json(
						{
							error: {
								message: "Request canceled by client",
								type: "canceled",
								param: null,
								code: "request_canceled",
							},
						},
						400,
					);
				}

				return c.json(
					{
						error: {
							message: clientFacingUpstreamFailureMessage(
								providerId,
								isTimeout
									? "Upstream provider timeout"
									: "Failed to connect to provider",
								fetchError.message,
							),
							type: isTimeout ? "upstream_timeout" : "upstream_error",
							param: null,
							code: isTimeout ? "timeout" : "fetch_failed",
						},
					},
					isTimeout ? 504 : 502,
				);
			}

			const duration = Date.now() - startedAt;
			const responseSize = upstreamText.length;

			let upstreamJson: unknown = null;
			if (upstreamText) {
				try {
					upstreamJson = JSON.parse(upstreamText);
				} catch {
					upstreamJson = upstreamText;
				}
			}

			if (!upstreamResponse.ok) {
				const status = upstreamResponse.status;
				if (attempt.envVarName !== undefined) {
					reportKeyError(
						attempt.envVarName,
						attempt.configIndex,
						status,
						upstreamText,
						upstreamModel,
					);
				}
				const failedTrackedKeyId =
					attempt.providerKey?.id ?? attempt.managedKey?.id;
				if (failedTrackedKeyId) {
					reportTrackedKeyError(
						failedTrackedKeyId,
						status,
						upstreamText,
						upstreamModel,
					);
				}

				const finishReason = getFinishReasonFromError(status, upstreamText);
				const nextAttempt = shouldRetryAlternateKey(
					finishReason,
					status,
					upstreamText,
				)
					? await resolveNextAttempt(attempt)
					: null;
				const willRetry = nextAttempt !== null;

				routingAttempts.push(
					buildRoutingAttempt(
						providerId,
						modelDefId,
						status,
						getErrorType(status),
						false,
						{
							apiKeyHash: usedApiKeyHash,
							credentialSource,
							providerKeyId,
							providerKeyLabel: keyLabel,
							logId: willRetry ? attemptLogId : finalLogId,
						},
					),
				);

				await insertLog(
					{
						...baseLogEntry,
						id: willRetry ? attemptLogId : finalLogId,
						routingMetadata: buildSystemOneRoutingMetadata(
							usedApiKeyHash,
							credentialSource,
							usedProviderKey,
						),
						duration,
						timeToFirstToken: null,
						timeToFirstReasoningToken: null,
						responseSize,
						content: null,
						reasoningContent: null,
						finishReason,
						promptTokens: null,
						completionTokens: null,
						totalTokens: null,
						reasoningTokens: null,
						cachedTokens: null,
						hasError: true,
						streamed: false,
						canceled: false,
						errorDetails: {
							statusCode: status,
							statusText: upstreamResponse.statusText,
							responseText: upstreamText,
						},
						inputCost: 0,
						outputCost: 0,
						cachedInputCost: 0,
						requestCost: 0,
						webSearchCost: 0,
						imageInputTokens: null,
						imageOutputTokens: null,
						imageInputCost: null,
						imageOutputCost: null,
						cost: 0,
						estimatedCost: false,
						discount: null,
						pricingTier: null,
						dataStorageCost: calculateDataStorageCost(
							null,
							null,
							null,
							null,
							retentionLevel,
						),
						cached: false,
						toolResults: null,
						retried: willRetry,
						retriedByLogId: willRetry ? finalLogId : null,
					},
					{ retentionLevel },
				);

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

				if (shouldRedactProviderError(providerId)) {
					return c.json(
						{
							error: {
								message: redactedProviderErrorText(status),
								type: "upstream_error",
								param: null,
								code: "upstream_error",
							},
						},
						status as 400 | 401 | 403 | 404 | 410 | 429 | 500 | 502 | 503 | 504,
					);
				}

				const normalizedUpstreamError: Record<string, unknown> = {
					error: {
						message:
							typeof upstreamJson === "string"
								? upstreamJson
								: (upstreamResponse.statusText ?? "Upstream error"),
						type: "upstream_error",
						param: null,
						code: "upstream_error",
					},
				};

				return c.json(
					upstreamJson && typeof upstreamJson === "object"
						? upstreamJson
						: normalizedUpstreamError,
					status as 400 | 401 | 403 | 404 | 410 | 429 | 500 | 502 | 503 | 504,
				);
			}

			if (attempt.envVarName !== undefined) {
				reportKeySuccess(
					attempt.envVarName,
					attempt.configIndex,
					upstreamModel,
				);
			}
			const trackedKeyHealthId =
				attempt.providerKey?.id ?? attempt.managedKey?.id;
			if (trackedKeyHealthId) {
				reportTrackedKeySuccess(trackedKeyHealthId, upstreamModel);
			}

			const upstream =
				upstreamJson && typeof upstreamJson === "object"
					? (upstreamJson as Record<string, unknown>)
					: {};
			const usage =
				upstream.usage && typeof upstream.usage === "object"
					? (upstream.usage as Record<string, unknown>)
					: {};
			const inputTokens =
				typeof usage.input_tokens === "number" ? usage.input_tokens : null;
			const outputTokens =
				typeof usage.output_tokens === "number" ? usage.output_tokens : null;

			// Decisions are billed on input tokens only; output tokens are free.
			const inputCost =
				inputTokens !== null
					? Number(decisionMapping.inputPrice ?? "0") * inputTokens
					: 0;
			const requestCostNum = Number(decisionMapping.requestPrice ?? "0");
			const cost = inputCost + requestCostNum;

			const normalizedResponse: Record<string, unknown> = {
				...upstream,
				model: responseModel,
			};

			routingAttempts.push(
				buildRoutingAttempt(
					providerId,
					modelDefId,
					upstreamResponse.status,
					"none",
					true,
					{
						apiKeyHash: usedApiKeyHash,
						credentialSource,
						providerKeyId,
						providerKeyLabel: keyLabel,
						logId: finalLogId,
					},
				),
			);

			await insertLog(
				{
					...baseLogEntry,
					id: finalLogId,
					routingMetadata: buildSystemOneRoutingMetadata(
						usedApiKeyHash,
						credentialSource,
						usedProviderKey,
					),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize,
					content: JSON.stringify(normalizedResponse.answers ?? null).slice(
						0,
						1000,
					),
					reasoningContent: null,
					finishReason: "stop",
					promptTokens: inputTokens !== null ? inputTokens.toString() : null,
					completionTokens:
						outputTokens !== null ? outputTokens.toString() : null,
					totalTokens:
						inputTokens !== null
							? (inputTokens + (outputTokens ?? 0)).toString()
							: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: false,
					streamed: false,
					canceled: false,
					errorDetails: null,
					inputCost,
					outputCost: 0,
					cachedInputCost: 0,
					requestCost: requestCostNum,
					webSearchCost: 0,
					imageInputTokens: null,
					imageOutputTokens: null,
					imageInputCost: null,
					imageOutputCost: null,
					cost,
					estimatedCost: inputTokens === null,
					discount: null,
					pricingTier: null,
					dataStorageCost: calculateDataStorageCost(
						inputTokens,
						null,
						outputTokens,
						null,
						retentionLevel,
					),
					cached: false,
					toolResults: null,
				},
				{ retentionLevel },
			);

			return c.json(normalizedResponse);
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
});
