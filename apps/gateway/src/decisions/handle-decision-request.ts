import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import { buildRoutingAttempt } from "@/chat/tools/build-routing-attempt.js";
import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getFinishReasonFromError } from "@/chat/tools/get-finish-reason-from-error.js";
import {
	airsideListingToModelDefinition,
	resolveAirsideProviderBaseUrl,
} from "@/chat/tools/resolve-airside-model.js";
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
	findAirsidePairsByBareName,
	findApiKeyByToken,
	findEffectiveDiscount,
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
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { fetchProvider } from "@/lib/fetch-provider.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { assertOrganizationUsable } from "@/lib/organization-access.js";
import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";
import { providerRateLimitWindows } from "@/lib/rate-limit-windows.js";
import { assertSpendLimit } from "@/lib/spend-limit.js";
import {
	clientFacingUpstreamFailureMessage,
	redactedProviderErrorText,
	shouldRedactProviderError,
} from "@/lib/stealth-provider-errors.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";
import { validateModelOutput } from "@/lib/validate-model-output.js";

import {
	getAzureFoundryBaseUrl,
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
import type { ApiOrigin, InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";
import type { RoutingCredentialSource } from "@llmgateway/shared/routing-telemetry";
import type { Context } from "hono";

/** Deadline for loading remote request input, such as image downloads. */
const LOAD_BODY_TIMEOUT_MS = 30_000;

/**
 * The wire format a decision mapping speaks upstream. OpenAI and every Airside
 * carrier serve the OpenAI-compatible `POST /v1/decisions`; TypeSafe and Azure
 * (Microsoft-Decision-1) speak TypeSafe's System One.
 */
export type DecisionWireFormat = "openai" | "system-one";

interface DecisionMappingMatch {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
	explicitProvider: boolean;
	wireFormat: DecisionWireFormat;
	/** Served by an approved Airside listing rather than the static catalogue. */
	airside: boolean;
}

type SupportsDecisionProvider = (
	providerId: string,
	wireFormat: DecisionWireFormat,
) => boolean;

function splitRequestedModel(modelId: string): {
	requestedProvider: string | undefined;
	modelKey: string;
} {
	const slashIdx = modelId.indexOf("/");
	return slashIdx > 0
		? {
				requestedProvider: modelId.slice(0, slashIdx),
				modelKey: modelId.slice(slashIdx + 1),
			}
		: { requestedProvider: undefined, modelKey: modelId };
}

function pickDecisionMatch(
	candidates: Omit<DecisionMappingMatch, "explicitProvider">[],
	requestedProvider: string | undefined,
	supportsProvider: SupportsDecisionProvider,
): { match: DecisionMappingMatch | null; unsupported: boolean } {
	let unsupported = false;
	for (const candidate of candidates) {
		if (
			requestedProvider &&
			candidate.mapping.providerId !== requestedProvider
		) {
			continue;
		}
		if (!supportsProvider(candidate.mapping.providerId, candidate.wireFormat)) {
			unsupported = true;
			continue;
		}
		return {
			match: {
				...candidate,
				explicitProvider: requestedProvider !== undefined,
			},
			unsupported: false,
		};
	}
	return { match: null, unsupported };
}

function staticDecisionCandidates(
	modelKey: string,
	airsideOwnedPairs: ReadonlySet<string> = new Set(),
): Omit<DecisionMappingMatch, "explicitProvider">[] {
	const candidates: Omit<DecisionMappingMatch, "explicitProvider">[] = [];
	for (const model of modelDefinitions as ModelDefinition[]) {
		// The provider's own moving aliases (`jev-latest`) resolve to the pinned
		// catalogue entry, so a request is always billed and logged against the
		// version we have prices for.
		if (model.id !== modelKey && !model.aliases?.includes(modelKey)) {
			continue;
		}
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (
				!candidate.decisions ||
				airsideOwnedPairs.has(`${model.id}:${candidate.providerId}`)
			) {
				continue;
			}
			candidates.push({
				mapping: candidate,
				modelDef: model,
				modelDefId: model.id,
				wireFormat: candidate.providerId === "openai" ? "openai" : "system-one",
				airside: false,
			});
		}
	}
	return candidates;
}

/**
 * Resolves a requested decision model across the static catalogue and
 * approved Airside decision listings. A listing owns its pair: a paused or
 * delisted one keeps the static mapping of the same pair out of service too.
 */
export async function resolveDecisionMapping(
	modelId: string,
	supportsProvider: SupportsDecisionProvider = () => true,
): Promise<{ match: DecisionMappingMatch | null; unsupported: boolean }> {
	const { requestedProvider, modelKey } = splitRequestedModel(modelId);
	let owned = await findAirsidePairsByBareName(modelKey);
	if (owned.listings.length === 0 && owned.unlisted.length === 0) {
		const canonical = (modelDefinitions as ModelDefinition[]).find((model) =>
			model.aliases?.includes(modelKey),
		);
		if (canonical) {
			owned = await findAirsidePairsByBareName(canonical.id);
		}
	}
	const airsideOwnedPairs = new Set([
		...owned.unlisted.map((pair) => `${pair.modelId}:${pair.providerId}`),
		...owned.listings.map(
			(listed) => `${listed.mapping.modelId}:${listed.mapping.providerId}`,
		),
	]);
	const now = new Date();
	// Static mappings win a bare id; among carriers the cheapest listing does,
	// with the provider id as a stable tie-break.
	const airsideCandidates = [...owned.listings]
		.sort(
			(left, right) =>
				new Decimal(left.mapping.inputPrice ?? "0").comparedTo(
					right.mapping.inputPrice ?? "0",
				) || left.mapping.providerId.localeCompare(right.mapping.providerId),
		)
		.filter(
			(listed) =>
				listed.mapping.decisions &&
				(!listed.mapping.deactivatedAt || listed.mapping.deactivatedAt > now),
		)
		.map((listed) => {
			const { mapping, modelInfo } = airsideListingToModelDefinition(listed);
			return {
				mapping,
				modelDef: modelInfo,
				modelDefId: modelInfo.id,
				wireFormat: "openai" as const,
				airside: true,
			};
		});
	return pickDecisionMatch(
		[
			...staticDecisionCandidates(modelKey, airsideOwnedPairs),
			...airsideCandidates,
		],
		requestedProvider,
		supportsProvider,
	);
}

/** Flat token estimate per input image: one high-detail 512px tile. */
const ESTIMATED_TOKENS_PER_IMAGE = 765;

/**
 * Input tokens for a request whose response reported no usable count: about
 * four characters per token of text, plus a flat amount per image so a large
 * inline image is not billed by its base64 length.
 */
export function estimateInputTokens(body: Record<string, unknown>): number {
	let images = 0;
	const text = JSON.stringify(body, (key, value: unknown) => {
		// `image_url` on the OpenAI shape, `data_base64` on a System One asset.
		if (
			(key === "image_url" || key === "data_base64") &&
			typeof value === "string"
		) {
			images++;
			return "";
		}
		return value;
	});
	const imageTokens = images * ESTIMATED_TOKENS_PER_IMAGE;
	return Math.ceil(text.length / 4) + imageTokens;
}

/** Reports a misconfigured Azure resource as a 400 rather than a bare 500. */
function toAzureFoundryBaseUrl(resource: string): string {
	try {
		return getAzureFoundryBaseUrl(resource);
	} catch {
		throw new HTTPException(400, {
			message: `Invalid Azure resource "${resource}": must be 1-64 letters, digits, or hyphens`,
		});
	}
}

async function assertCreditsAvailable(
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

export interface DecisionUpstreamRequest {
	/** Path appended to the provider base URL, e.g. `/v1/decisions`. */
	path: string;
	body: Record<string, unknown>;
	/** Extra request headers, e.g. TypeSafe's image opt-in. */
	headers?: Record<string, string>;
	/**
	 * Loads remote input, such as image downloads, merged into `body`. Runs only
	 * once the request passed the rate-limit, credit and credential gates, and
	 * must stop when `signal` aborts (client disconnect or load deadline).
	 */
	loadBody?: (signal: AbortSignal) => Promise<Record<string, unknown>>;
}

export interface NormalizedDecisionResponse {
	/** Body returned to the client. */
	body: Record<string, unknown>;
	inputTokens: number | null;
	outputTokens: number | null;
	/** Answers kept on the log entry. */
	logContent: unknown;
}

/**
 * One public decision endpoint (`/v1/decisions` or the legacy
 * `/v1/systemone`). The shared handler owns auth, credentials, retries,
 * billing and logging; the endpoint only translates its wire format to and
 * from whatever the resolved provider speaks.
 */
export interface DecisionEndpoint {
	apiOrigin: Extract<ApiOrigin, "decisions" | "systemone">;
	/** Public path, used in error messages. */
	path: string;
	startedAt: number;
	requestId: string;
	rawBody: unknown;
	requestedModel: string;
	/** One-line request summary stored as the log's user message. */
	logSummary: string;
	supportsProvider?: SupportsDecisionProvider;
	/** Hint appended when the model exists but this endpoint can't serve it. */
	unsupportedModelHint?: string;
	/** The request carries image input. */
	hasImageInput?: boolean;
	/**
	 * Throw an HTTPException(400) for input the provider can't take.
	 * `safetyIdentifier` is the authenticating API key's abuse-attribution id.
	 */
	buildUpstreamRequest: (
		providerId: string,
		upstreamModel: string,
		safetyIdentifier: string,
		wireFormat: DecisionWireFormat,
	) => DecisionUpstreamRequest;
	normalizeResponse: (
		providerId: string,
		upstream: Record<string, unknown>,
		responseModel: string,
		wireFormat: DecisionWireFormat,
	) => NormalizedDecisionResponse;
}

export async function handleDecisionRequest(
	c: Context<ServerTypes>,
	endpoint: DecisionEndpoint,
): Promise<Response> {
	const { startedAt, requestId, rawBody, requestedModel } = endpoint;
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

	const { match, unsupported } = await resolveDecisionMapping(
		requestedModel,
		endpoint.supportsProvider,
	);
	if (!match) {
		return c.json(
			{
				error: {
					message: unsupported
						? `Model ${requestedModel} is not available on ${endpoint.path}.${
								endpoint.unsupportedModelHint
									? ` ${endpoint.unsupportedModelHint}`
									: ""
							}`
						: `Model ${requestedModel} not found or is not a decision model`,
					type: "invalid_request_error",
					param: "model",
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
		wireFormat,
		airside,
	} = match;
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
		providerAccessRestriction: organization.providerAccessRestriction,
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

	if (endpoint.hasImageInput && !decisionMapping.vision) {
		throw new HTTPException(400, {
			message: `Model ${requestedModel} accepts text input only; remove the input_image parts.`,
		});
	}

	// Translate only once the caller is allowed to use the model, so a denied
	// caller sees the access error rather than an input error. Translation runs
	// before the rate-limit check, so an invalid request uses no slot.
	const upstreamRequest = endpoint.buildUpstreamRequest(
		providerId,
		upstreamModel,
		apiKey.safetyIdentifier,
		wireFormat,
	);
	let upstreamBody = upstreamRequest.body;

	// Carrier-set and admin caps for the pair apply as they do on chat.
	const rateLimit = await checkProviderRateLimit(
		project.organizationId,
		providerId,
		modelDefId,
	);
	if (!rateLimit.allowed) {
		if (rateLimit.retryAfter) {
			c.header("Retry-After", rateLimit.retryAfter.toString());
		}
		const blockedLimits = rateLimit.blockedBy
			.map(
				(window) =>
					`${rateLimit.limits[window].limit} ${providerRateLimitWindows[window].label}`,
			)
			.join(" and ");
		throw new HTTPException(429, {
			message: `Rate limit exceeded: maximum ${blockedLimits} for this provider/model. Please try again later.`,
		});
	}

	const discount = new Decimal(
		(
			await findEffectiveDiscount(
				project.organizationId,
				providerId,
				modelDefId,
			)
		).discount,
	);
	// An Airside carrier without a catalogue entry is reached at the endpoint
	// registered on its approved claim.
	const airsideBaseUrl = airside
		? await resolveAirsideProviderBaseUrl(providerId)
		: undefined;

	const failedKeys = createFailedKeyTracker();
	const routingAttempts: RoutingAttempt[] = [];
	const finalLogId = shortid();

	const buildRoutingMetadata = (
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

	interface DecisionAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		/** Platform-managed credential when one served this attempt. */
		managedKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
		tenantBaseUrl: string | null;
		requestBody: Record<string, unknown>;
	}

	async function resolveAttempt(): Promise<DecisionAttempt> {
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
					model: modelDefId,
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
			await assertCreditsAvailable(
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
				await assertCreditsAvailable(
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

		const credential = {
			providerKey: providerKeyInner,
			managedKey: managedKeyInner,
		};
		// Azure has no fixed host: a credential names its resource, and the
		// decision route lives on that resource's Foundry host.
		const azureResource =
			providerId === "azure"
				? (providerKeyInner?.options?.azure_resource ??
					getCredentialSetting("azure", "resource", credential, {
						configIndex,
						variant: envVariant,
					}))
				: undefined;
		// The decision route only exists on the Foundry host, so a resource wins
		// over an Azure base URL, which points at the OpenAI-compatible surface.
		const resolvedBaseUrl =
			(azureResource ? toAzureFoundryBaseUrl(azureResource) : undefined) ??
			providerKeyInner?.baseUrl ??
			airsideBaseUrl ??
			getCredentialSetting(providerId as Provider, "baseUrl", credential, {
				configIndex,
				variant: envVariant,
			}) ??
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
			upstreamUrl: `${resolvedBaseUrl.replace(/\/+$/, "")}${upstreamRequest.path}`,
			tenantBaseUrl: providerKeyInner?.baseUrl ?? airsideBaseUrl ?? null,
			requestBody: upstreamBody,
		};
	}

	async function resolveNextAttempt(
		failedAttempt: DecisionAttempt,
	): Promise<DecisionAttempt | null> {
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

	let attempt: DecisionAttempt = await resolveAttempt();

	// Remote input (image downloads) loads only after the first attempt passed
	// the credit and credential gates; retries reuse the loaded body.
	if (upstreamRequest.loadBody) {
		const loadSignal = AbortSignal.any([
			c.req.raw.signal,
			AbortSignal.timeout(LOAD_BODY_TIMEOUT_MS),
		]);
		upstreamBody = {
			...upstreamBody,
			...(await upstreamRequest.loadBody(loadSignal)),
		};
		attempt = { ...attempt, requestBody: upstreamBody };
	}

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	try {
		while (true) {
			attempt.requestBody = { ...attempt.requestBody };
			if (attempt.providerKey) {
				delete attempt.requestBody.safety_identifier;
			}
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
						content: endpoint.logSummary,
					},
				],
				source,
				apiOrigin: endpoint.apiOrigin,
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
				upstreamResponse = await fetchProvider(
					attempt.upstreamUrl,
					{
						method: "POST",
						// SSRF: never follow redirects on an authenticated provider request.
						redirect: "error",
						headers: {
							"Content-Type": "application/json",
							...upstreamRequest.headers,
							...getProviderHeaders(providerId, attempt.usedToken, {
								requestId,
							}),
						},
						body: JSON.stringify(attempt.requestBody),
						signal: fetchSignal,
					},
					attempt.tenantBaseUrl,
				);
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
						routingMetadata: buildRoutingMetadata(
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
						routingMetadata: buildRoutingMetadata(
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
			const normalized = endpoint.normalizeResponse(
				providerId,
				upstream,
				responseModel,
				wireFormat,
			);
			const { outputTokens } = normalized;
			// Without a usable count the request is billed on an estimate rather
			// than for free.
			const inputTokens =
				normalized.inputTokens ?? estimateInputTokens(attempt.requestBody);
			const estimatedInput = normalized.inputTokens === null;

			// Decisions are billed on input tokens only; output tokens are free.
			// Long-context tiers reprice the whole request once input crosses them.
			const pricingTier = decisionMapping.pricingTiers?.find(
				(tier) => inputTokens <= tier.upToTokens,
			);
			const inputPrice = pricingTier?.inputPrice ?? decisionMapping.inputPrice;
			const priceMultiplier = new Decimal(1).minus(discount);
			const inputCost = new Decimal(inputPrice ?? "0")
				.times(inputTokens)
				.times(priceMultiplier)
				.toNumber();
			const requestCostNum = new Decimal(decisionMapping.requestPrice ?? "0")
				.times(priceMultiplier)
				.toNumber();
			const cost = new Decimal(inputCost).plus(requestCostNum).toNumber();

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
					routingMetadata: buildRoutingMetadata(
						usedApiKeyHash,
						credentialSource,
						usedProviderKey,
					),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize,
					content: JSON.stringify(normalized.logContent ?? null).slice(0, 1000),
					reasoningContent: null,
					finishReason: "stop",
					promptTokens: inputTokens.toString(),
					completionTokens:
						outputTokens !== null ? outputTokens.toString() : null,
					totalTokens: (inputTokens + (outputTokens ?? 0)).toString(),
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
					estimatedCost: estimatedInput,
					discount: discount.isZero() ? null : discount.toNumber(),
					pricingTier: pricingTier?.name ?? null,
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

			return c.json(normalized.body);
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
}
