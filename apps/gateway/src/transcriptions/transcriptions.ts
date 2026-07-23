import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { buildRoutingAttempt } from "@/chat/tools/build-routing-attempt.js";
import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getFinishReasonFromError } from "@/chat/tools/get-finish-reason-from-error.js";
import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
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
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import { assertProviderCompliant } from "@/lib/compliance.js";
import {
	applyEndUserSession,
	assertTestWalletModelAllowed,
} from "@/lib/end-user-session.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getOrganizationEnvVariant,
	getProviderEnvValue,
	models as modelDefinitions,
} from "@llmgateway/models";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

// The request arrives as multipart/form-data (OpenAI-compatible surface). The
// schema documents the accepted fields; parsing happens via parseBody so file
// uploads stream through Hono's multipart handling.
const transcriptionFormSchema = z
	.object({
		model: z.string().openapi({
			description: "ID of the transcription (speech-to-text) model to use.",
			example: "grok-stt-1-0",
		}),
		file: z.any().optional().openapi({
			type: "string",
			format: "binary",
			description:
				"The audio file to transcribe. Required unless `url` is provided.",
		}),
		url: z.string().optional().openapi({
			description:
				"URL of an audio file to download and transcribe upstream. Required unless `file` is provided.",
		}),
		language: z.string().optional().openapi({
			description:
				"Language code (e.g. 'en'). When set, enables inverse text normalization so numbers and currencies are formatted in their written form.",
			example: "en",
		}),
		diarize: z.string().optional().openapi({
			description:
				"When 'true', enables speaker diarization; each word in the response includes a `speaker` field.",
		}),
		filler_words: z.string().optional().openapi({
			description:
				"When 'true', filler words (e.g. 'uh', 'um') are kept in the transcript instead of being removed.",
		}),
		keyterm: z.string().optional().openapi({
			description:
				"A key term to bias transcription toward (e.g. product names). Repeat the field for multiple terms.",
		}),
	})
	.openapi({
		description: "Multipart form fields for the transcription request.",
	});

const transcriptionWordSchema = z
	.object({
		text: z.string().optional(),
		start: z.number().optional(),
		end: z.number().optional(),
		speaker: z.number().optional(),
	})
	.passthrough();

const transcriptionResponseSchema = z
	.object({
		text: z.string().optional(),
		language: z.string().optional(),
		duration: z.number().optional(),
		words: z.array(transcriptionWordSchema).optional(),
		channels: z.array(z.record(z.unknown())).optional(),
	})
	.passthrough()
	.openapi({
		description:
			"Transcription payload: full transcript text, detected language, audio duration in seconds and word-level timestamps.",
	});

const transcriptionErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

interface TranscriptionErrorBody {
	error: {
		message: string;
		type: string;
		param: string | null;
		code: string;
	};
}

function findTranscriptionMapping(modelId: string): {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
	explicitProvider: boolean;
} | null {
	// Split an optional "<provider>/<model>" prefix so callers can pin a
	// provider explicitly. Transcription currently resolves to a single
	// provider, but the shape mirrors the ocr/speech endpoints for consistency.
	let requestedProvider: string | undefined;
	let modelKey = modelId;
	const slashIdx = modelId.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = modelId.slice(0, slashIdx);
		modelKey = modelId.slice(slashIdx + 1);
	}
	for (const model of modelDefinitions) {
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (!candidate.transcriptions) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			if (model.id === modelKey) {
				return {
					mapping: candidate,
					modelDef: model,
					modelDefId: model.id,
					explicitProvider: requestedProvider !== undefined,
				};
			}
		}
	}
	return null;
}

function getAvailableCredits(
	organization: InferSelectModel<typeof tables.organization>,
) {
	const regularCredits = parseFloat(organization.credits ?? "0");
	const devPlanCreditsRemaining =
		organization.devPlan !== "none"
			? parseFloat(organization.devPlanCreditsLimit ?? "0") -
				parseFloat(organization.devPlanCreditsUsed ?? "0")
			: 0;
	const chatPlanCreditsRemaining =
		organization.chatPlan !== "none"
			? parseFloat(organization.chatPlanCreditsLimit ?? "0") -
				parseFloat(organization.chatPlanCreditsUsed ?? "0")
			: 0;

	return {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits:
			regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining,
	};
}

function assertCreditsAvailableForTranscription(
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
	devPlanCreditLimitMessage: (renewalDate: string) => string,
) {
	const {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits,
	} = getAvailableCredits(organization);

	if (totalAvailableCredits > 0 || modelDef.free) {
		return;
	}

	if (organization.devPlan !== "none" && devPlanCreditsRemaining <= 0) {
		const renewalDate = organization.devPlanExpiresAt
			? new Date(organization.devPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: devPlanCreditLimitMessage(renewalDate),
		});
	}

	if (organization.chatPlan !== "none" && chatPlanCreditsRemaining <= 0) {
		const renewalDate = organization.chatPlanExpiresAt
			? new Date(organization.chatPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: `Chat Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		});
	}

	throw new HTTPException(402, { message: insufficientCreditsMessage });
}

export const transcriptions = new OpenAPIHono<ServerTypes>();

const createTranscription = createRoute({
	operationId: "v1_audio_transcriptions",
	summary: "Create transcription",
	description:
		"Transcribes audio into text (speech-to-text) with word-level timestamps. The request body is multipart/form-data carrying the audio file (or a URL to it).",
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
				"multipart/form-data": {
					schema: transcriptionFormSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: transcriptionResponseSchema,
				},
			},
			description: "Transcription response.",
		},
		400: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Invalid request body or parameters.",
		},
		401: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Unauthorized request.",
		},
		402: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Payment required / insufficient credits.",
		},
		403: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Forbidden.",
		},
		410: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Archived or unavailable project.",
		},
		413: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Audio file too large.",
		},
		429: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Rate limited upstream response.",
		},
		500: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Internal server error.",
		},
		502: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Failed to connect to the upstream provider.",
		},
		503: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Service unavailable upstream response.",
		},
		504: {
			content: { "application/json": { schema: transcriptionErrorSchema } },
			description: "Upstream provider timeout.",
		},
	},
});

// Promise<any> like the OCR route: the handler passes upstream JSON through
// with runtime-determined status codes, which cannot satisfy OpenAPIHono's
// RouteConfigToTypedResponse union derived from the declared schemas.
transcriptions.openapi(createTranscription, async (c): Promise<any> => {
	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);
	c.header("x-request-id", requestId);

	const contentType = c.req.header("Content-Type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		return c.json(
			{
				error: {
					message:
						"Content-Type must be multipart/form-data for transcription requests",
					type: "invalid_request_error",
					param: null,
					code: "invalid_content_type",
				},
			} satisfies TranscriptionErrorBody,
			400,
		);
	}

	let formBody: Record<string, string | File | (string | File)[]>;
	try {
		formBody = await c.req.parseBody({ all: true });
	} catch {
		return c.json(
			{
				error: {
					message: "Invalid multipart form data in request body",
					type: "invalid_request_error",
					param: null,
					code: "invalid_form_data",
				},
			} satisfies TranscriptionErrorBody,
			400,
		);
	}

	const firstString = (value: unknown): string | undefined => {
		const single = Array.isArray(value) ? value[0] : value;
		return typeof single === "string" && single.length > 0 ? single : undefined;
	};

	const requestedModel = firstString(formBody.model);
	if (!requestedModel) {
		return c.json(
			{
				error: {
					message: "Missing required field: model",
					type: "invalid_request_error",
					param: "model",
					code: "invalid_parameters",
				},
			} satisfies TranscriptionErrorBody,
			400,
		);
	}

	const rawFile = Array.isArray(formBody.file)
		? formBody.file[0]
		: formBody.file;
	const file = rawFile instanceof File ? rawFile : undefined;
	const url = firstString(formBody.url);
	if (!file && !url) {
		return c.json(
			{
				error: {
					message: "Either an audio `file` or a `url` must be provided",
					type: "invalid_request_error",
					param: "file",
					code: "invalid_parameters",
				},
			} satisfies TranscriptionErrorBody,
			400,
		);
	}

	const language = firstString(formBody.language);
	const diarize = firstString(formBody.diarize) === "true";
	const fillerWords = firstString(formBody.filler_words) === "true";
	const keytermValues = Array.isArray(formBody.keyterm)
		? formBody.keyterm
		: formBody.keyterm !== undefined
			? [formBody.keyterm]
			: [];
	const keyterms = keytermValues.filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	const match = findTranscriptionMapping(requestedModel);
	if (!match) {
		return c.json(
			{
				error: {
					message: `Transcription model not found: ${requestedModel}`,
					type: "invalid_request_error",
					param: "model",
					code: "model_not_found",
				},
			} satisfies TranscriptionErrorBody,
			400,
		);
	}

	const { mapping, modelDef, modelDefId, explicitProvider } = match;
	const upstreamModel = mapping.externalId;
	const providerId = mapping.providerId;

	const startedAt = Date.now();
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
	const inputPreview = file
		? `[audio file: ${file.name || "audio"} (${file.size} bytes)]`
		: `[audio url: ${url}]`;
	const normalizedMessages = [{ role: "user" as const, content: inputPreview }];

	// Loggable summary of the multipart request (the audio bytes themselves are
	// never stored).
	const upstreamRequestSummary: Record<string, unknown> = {
		model: upstreamModel,
		...(file ? { file: { name: file.name, size: file.size } } : {}),
		...(url ? { url } : {}),
		...(language ? { language, format: true } : {}),
		...(diarize ? { diarize: true } : {}),
		...(fillerWords ? { filler_words: true } : {}),
		...(keyterms.length > 0 ? { keyterm: keyterms } : {}),
	};

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

	// User-level limits take priority: enforce the per-member budget (set on the
	// Teams page; fails open on read errors) before the per-key usage limits, so a
	// member who is over budget is denied even if the key itself is within limits.
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

	if (baseOrganization.status === "deleted") {
		throw new HTTPException(410, {
			message: "Organization has been disabled and is no longer accessible",
		});
	}

	// LLM SDK: ephemeral end-user sessions bill the bound wallet instead of the
	// developer's org credits. For normal keys this is a no-op.
	const { project, organization, wallet } = await applyEndUserSession(
		c,
		apiKey,
		baseProject,
		baseOrganization,
	);

	// Sandbox wallets can only spend on free models (none for transcription
	// today), so this rejects paid transcription requests from test-mode
	// end-user sessions.
	assertTestWalletModelAllowed(wallet, modelDef);

	if (organization.kind === "devpass" && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"Transcription is not available for coding plans. Coding plans only include text-based inference.",
		});
	}

	const retentionLevel = organization.retentionLevel ?? "none";
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

	// Enterprise provider compliance policy: transcription resolves to a single
	// provider, so block the request before any data is sent if that provider
	// doesn't meet the org's required certifications/data policies.
	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: modelDefId,
		apiKeyId: apiKey.id,
		model: requestedModel,
	});

	const finalLogId = shortid();
	const failedKeys = createFailedKeyTracker();

	const selectionReason = explicitProvider
		? "direct-provider-specified"
		: "single-provider-available";
	const routingAttempts: RoutingAttempt[] = [];
	const buildTranscriptionRoutingMetadata = (
		usedApiKeyHash: string | undefined,
	): RoutingMetadata => ({
		availableProviders: [providerId],
		selectedProvider: providerId,
		selectionReason,
		...(usedApiKeyHash ? { usedApiKeyHash } : {}),
		providerScores: [],
		...(routingAttempts.length > 0 ? { routing: routingAttempts } : {}),
	});

	const retryProject = {
		mode: project.mode,
		organizationId: project.organizationId,
	};
	const retryOrganization = organization;

	// Which env-var variant (`__ENTERPRISE` / `__PLANS` overrides) applies to
	// this org's env-credential reads. Undefined = base vars only.
	const envVariant = getOrganizationEnvVariant(retryOrganization);

	// Option fields must precede the file in the multipart body — the upstream
	// xAI /v1/stt endpoint ignores fields sent after `file` on streamed uploads.
	function buildUpstreamForm(): FormData {
		const upstreamForm = new FormData();
		if (language) {
			upstreamForm.append("format", "true");
			upstreamForm.append("language", language);
		}
		if (diarize) {
			upstreamForm.append("diarize", "true");
		}
		if (fillerWords) {
			upstreamForm.append("filler_words", "true");
		}
		for (const term of keyterms) {
			upstreamForm.append("keyterm", term);
		}
		if (url) {
			upstreamForm.append("url", url);
		} else if (file) {
			upstreamForm.append("file", file, file.name || "audio");
		}
		return upstreamForm;
	}

	interface TranscriptionAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
	}

	async function resolveAttempt(): Promise<TranscriptionAttempt> {
		let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		let usedToken: string | undefined;
		let configIndex = 0;
		let envVarName: string | undefined;

		const excludedProviderKeyIds = failedKeys.providerKeyIdsFor(
			providerId,
			undefined,
		);
		const excludedEnvKeyIndices = failedKeys.envKeyIndicesFor(
			providerId,
			undefined,
		);

		if (retryProject.mode === "api-keys") {
			providerKey = await findProviderKey(
				retryProject.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (!providerKey) {
				throw new HTTPException(400, {
					message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
				});
			}
			usedToken = providerKey.token;
		} else if (retryProject.mode === "credits") {
			assertCreditsAvailableForTranscription(
				retryOrganization,
				modelDef,
				`Organization ${retryOrganization.id} has insufficient credits`,
				(renewalDate) =>
					`Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
			);

			const envResult = getProviderEnv(providerId, {
				selectionScope: upstreamModel,
				excludedIndices: excludedEnvKeyIndices,
				variant: envVariant,
			});
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		} else if (retryProject.mode === "hybrid") {
			providerKey = await findProviderKey(
				retryProject.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (providerKey) {
				usedToken = providerKey.token;
			} else {
				assertCreditsAvailableForTranscription(
					retryOrganization,
					modelDef,
					"No API key set for provider and organization has insufficient credits",
					(renewalDate) =>
						`No API key set for provider. Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
				);

				const envResult = getProviderEnv(providerId, {
					selectionScope: upstreamModel,
					excludedIndices: excludedEnvKeyIndices,
					variant: envVariant,
				});
				usedToken = envResult.token;
				configIndex = envResult.configIndex;
				envVarName = envResult.envVarName;
			}
		} else {
			throw new HTTPException(400, {
				message: `Invalid project mode: ${retryProject.mode}`,
			});
		}

		if (retentionLevel === "retain") {
			const { totalAvailableCredits } = getAvailableCredits(retryOrganization);
			if (totalAvailableCredits <= 0) {
				throw new HTTPException(402, {
					message:
						"Organization has insufficient credits for data retention. Data retention requires credits for storage costs ($0.01 per 1M tokens). Please add credits or disable data retention in organization settings.",
				});
			}
		}

		if (!usedToken) {
			throw new HTTPException(500, {
				message: "No token",
			});
		}

		const envBaseUrl = getProviderEnvValue(
			providerId,
			"baseUrl",
			configIndex,
			undefined,
			envVariant,
		);
		const resolvedBaseUrl =
			providerKey?.baseUrl ?? envBaseUrl ?? "https://api.x.ai";

		return {
			providerKey,
			usedToken,
			configIndex,
			envVarName,
			upstreamUrl: `${resolvedBaseUrl}/v1/stt`,
		};
	}

	async function resolveNextAttempt(
		failedAttempt: TranscriptionAttempt,
	): Promise<TranscriptionAttempt | null> {
		failedKeys.remember(providerId, undefined, {
			envVarName: failedAttempt.envVarName,
			configIndex: failedAttempt.configIndex,
			providerKeyId: failedAttempt.providerKey?.id,
		});
		try {
			const next = await resolveAttempt();
			if (
				next.usedToken === failedAttempt.usedToken &&
				next.envVarName === failedAttempt.envVarName &&
				next.configIndex === failedAttempt.configIndex &&
				next.providerKey?.id === failedAttempt.providerKey?.id
			) {
				return null;
			}
			return next;
		} catch {
			return null;
		}
	}

	let attempt: TranscriptionAttempt = await resolveAttempt();

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	try {
		while (true) {
			const attemptLogId = shortid();
			const usedApiKeyHash = getApiKeyFingerprint(attempt.usedToken);
			const baseLogEntry = createLogEntry({
				requestId,
				project,
				apiKey,
				providerKeyId: attempt.providerKey?.id,
				usedModel: `${providerId}/${modelDefId}`,
				usedModelMapping: upstreamModel,
				usedProvider: providerId,
				requestedModel,
				requestedProvider: providerId,
				messages: normalizedMessages,
				source,
				customHeaders,
				debugMode,
				userAgent,
				rawRequest: upstreamRequestSummary,
				upstreamRequest: upstreamRequestSummary,
			});

			let upstreamResponse: Response;
			let fetchError: Error | null = null;
			try {
				const fetchSignal = createCombinedSignal(controller);
				// No explicit Content-Type: fetch derives the multipart boundary
				// from the FormData body.
				upstreamResponse = await fetch(attempt.upstreamUrl, {
					method: "POST",
					// SSRF: never follow redirects on an authenticated provider request. A
					// tenant-supplied baseUrl could 3xx to an internal host at request
					// time, and a redirect would also leak the upstream token.
					redirect: "error",
					headers: getProviderHeaders(providerId, attempt.usedToken, {
						requestId,
					}),
					body: buildUpstreamForm(),
					signal: fetchSignal,
				});
			} catch (error) {
				const isCanceled =
					error instanceof Error && error.name === "AbortError";
				const isTimeout = isTimeoutError(error);
				const isNetworkError = error instanceof TypeError;
				if (!isCanceled && !isTimeout && !isNetworkError) {
					throw error;
				}
				fetchError = error instanceof Error ? error : new Error(String(error));
				upstreamResponse = undefined as unknown as Response;
			}

			if (fetchError !== null) {
				const isCanceled = fetchError.name === "AbortError";
				const isTimeout = isTimeoutError(fetchError);
				const duration = Date.now() - startedAt;

				if (!isCanceled) {
					if (attempt.envVarName !== undefined) {
						reportKeyError(
							attempt.envVarName,
							attempt.configIndex,
							0,
							undefined,
							upstreamModel,
						);
					}
					if (attempt.providerKey?.id) {
						reportTrackedKeyError(
							attempt.providerKey.id,
							0,
							undefined,
							upstreamModel,
						);
					}
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
								logId: willRetry ? attemptLogId : finalLogId,
							},
						),
					);
				}

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildTranscriptionRoutingMetadata(usedApiKeyHash),
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
				});

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
						} satisfies TranscriptionErrorBody,
						400,
					);
				}

				return c.json(
					{
						error: {
							message: isTimeout
								? `Upstream provider timeout: ${fetchError.message}`
								: `Failed to connect to provider: ${fetchError.message}`,
							type: isTimeout ? "upstream_timeout" : "upstream_error",
							param: null,
							code: isTimeout ? "timeout" : "fetch_failed",
						},
					} satisfies TranscriptionErrorBody,
					isTimeout ? 504 : 502,
				);
			}

			const upstreamText = await upstreamResponse.text();
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
				if (attempt.providerKey?.id) {
					reportTrackedKeyError(
						attempt.providerKey.id,
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
							logId: willRetry ? attemptLogId : finalLogId,
						},
					),
				);

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildTranscriptionRoutingMetadata(usedApiKeyHash),
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
				});

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

				const normalizedUpstreamError: TranscriptionErrorBody = {
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
					status as
						| 400
						| 401
						| 403
						| 404
						| 410
						| 413
						| 429
						| 500
						| 502
						| 503
						| 504,
				);
			}

			if (attempt.envVarName !== undefined) {
				reportKeySuccess(
					attempt.envVarName,
					attempt.configIndex,
					upstreamModel,
				);
			}
			if (attempt.providerKey?.id) {
				reportTrackedKeySuccess(attempt.providerKey.id, upstreamModel);
			}

			const responseObject =
				upstreamJson && typeof upstreamJson === "object"
					? (upstreamJson as Record<string, unknown>)
					: undefined;
			const transcriptText =
				typeof responseObject?.text === "string" ? responseObject.text : null;
			const audioDurationRaw = responseObject?.duration;
			const audioDurationSeconds =
				typeof audioDurationRaw === "number" &&
				Number.isFinite(audioDurationRaw)
					? audioDurationRaw
					: null;
			if (audioDurationSeconds === null) {
				logger.warn("Transcription response missing duration", {
					requestId,
					provider: providerId,
					model: upstreamModel,
				});
			}

			// Billed on audio duration: inputAudioHourPrice is USD per hour of
			// input audio, the upstream reports duration in seconds.
			const hourPrice = Number(mapping.inputAudioHourPrice ?? "0");
			const requestCost = Number(mapping.requestPrice ?? "0");
			const audioCost =
				audioDurationSeconds !== null
					? (audioDurationSeconds / 3600) * hourPrice
					: 0;
			const cost = audioCost + requestCost;

			routingAttempts.push(
				buildRoutingAttempt(
					providerId,
					modelDefId,
					upstreamResponse.status,
					"none",
					true,
					{
						apiKeyHash: usedApiKeyHash,
						logId: finalLogId,
					},
				),
			);

			await insertLog({
				...baseLogEntry,
				id: finalLogId,
				routingMetadata: buildTranscriptionRoutingMetadata(usedApiKeyHash),
				duration,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize,
				content:
					transcriptText !== null
						? `[transcript: ${transcriptText.length} chars, ${audioDurationSeconds ?? "?"}s audio]`
						: null,
				reasoningContent: null,
				finishReason: "stop",
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: false,
				streamed: false,
				canceled: false,
				errorDetails: null,
				inputCost: audioCost,
				outputCost: 0,
				cachedInputCost: 0,
				requestCost,
				webSearchCost: 0,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				cost,
				estimatedCost: audioDurationSeconds === null,
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
			});

			return c.json(
				upstreamJson as z.infer<typeof transcriptionResponseSchema>,
			);
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
});
