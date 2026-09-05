import { HTTPException } from "hono/http-exception";

import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	findCustomProviderKey,
	findProviderKey,
	listEligibleProviderKeys,
} from "@/lib/cached-queries.js";
import { getLicensedOrganizationEnvVariant } from "@/lib/enterprise.js";
import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { posthog } from "@/posthog.js";

import {
	getGcpServiceAccountAccessToken,
	getProviderEndpoint,
	getProviderHeaders,
	isPremiumServiceTier,
	managedCredentialOptions,
	prepareRequestBody,
	providerKeyLabel,
	readProviderKey,
	selectProviderMapping,
} from "@llmgateway/actions";
import { providerKeyAllowsModel } from "@llmgateway/db";
import {
	type BaseMessage,
	getRegionSpecificEnvVarName,
	getVariantEnvVarNameFor,
	hasMaxTokens,
	type ModelDefinition,
	type OpenAIRequestBody,
	type OpenAIToolInput,
	type PromptCacheOptions,
	type PromptCacheRetention,
	type Provider,
	type ProviderCacheControlMode,
	type ProviderRequestBody,
	providers,
	resolveVertexTokenType,
	type ToolChoiceType,
	type VertexTokenType,
	type WebSearchTool,
} from "@llmgateway/models";
import {
	DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	type DevPlanTier,
	getRemainingPremiumWeeklyAllowance,
	isPremiumModel,
} from "@llmgateway/shared";

import { clampTemperature } from "./clamp-temperature.js";
import { resolvePlatformCredential } from "./resolve-platform-credential.js";
import {
	assertServiceTierHonored,
	getForwardedServiceTier,
	providerKeySupportsServiceTier,
} from "./service-tier.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

export interface ProviderContext {
	usedProvider: Provider;
	/**
	 * Canonical LLM Gateway model id. Used for everything internal: pricing,
	 * discounts, rate limits, IAM, key selection, logging display. Never the
	 * upstream provider's model id.
	 */
	usedInternalModel: string;
	/**
	 * Provider-specific upstream model id. Reserved for sending the request
	 * to the upstream provider API; do not use for internal lookups.
	 */
	usedExternalId: string;
	usedModelFormatted: string;
	usedModelMapping: string;
	usedToken: string;
	usedApiKeyHash: string;
	providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	/**
	 * Platform-managed credential serving this credits-mode request, when one
	 * is configured. Distinct from `providerKey`, which is always the
	 * organization's own BYOK key.
	 */
	managedKey: InferSelectModel<typeof tables.providerKey> | undefined;
	/**
	 * Provider-key id to attribute health failures to via reportTrackedKey*.
	 * Equal to `providerKey.id` when the BYOK key is the credential actually
	 * sent, undefined when a regional env-var override replaces the token
	 * (in which case `envVarName` carries the health attribution).
	 */
	trackedKeyHealthId: string | undefined;
	configIndex: number;
	envVarName: string | undefined;
	url: string;
	requestBody: ProviderRequestBody | FormData;
	useResponsesApi: boolean;
	requestCanBeCanceled: boolean;
	isImageGeneration: boolean;
	supportsReasoning: boolean;
	splitTaggedReasoning: boolean;
	healStreamingJsonOutput: boolean;
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
	/**
	 * Parameters dropped because the selected mapping's supportedParameters
	 * doesn't include them. Merged into routingMetadata.strippedParameters so
	 * retry fallbacks keep the logged metadata accurate.
	 */
	strippedParameters: string[];
	headers: Record<string, string>;
	usedRegion: string | undefined;
	/**
	 * The organization's own keys that could have served this provider, in
	 * selection order — the candidate set the credential above was chosen from.
	 * Undefined in credits mode, which routes on platform credentials only.
	 */
	eligibleProviderKeys: Array<{ id: string; label?: string }> | undefined;
}

export interface OriginalRequestParams {
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
}

export interface ProviderContextOptions {
	requestId: string;
	/**
	 * Set when the request is a zero-rated onboarding call. The credit assertion
	 * below mirrors chat.ts's gate, so without this a fallback to a platform
	 * credential re-imposes the 402 that the sponsored path just waived — only on
	 * the flaky-provider branch, so it fails intermittently and invisibly.
	 */
	sponsoredOnboarding?: boolean;
	/**
	 * Custom Airside carriers have no catalogue endpoint definition: retries
	 * and credential failover route to the OpenAI-compatible base URL on the
	 * approved registration, exactly like the first attempt in chat.ts.
	 */
	airsideCustomBaseUrl?: string;
	stream: boolean;
	effectiveStream: boolean;
	messages: BaseMessage[];
	response_format: OpenAIRequestBody["response_format"];
	tools: OpenAIToolInput[] | undefined;
	tool_choice: ToolChoiceType | undefined;
	reasoning_effort:
		| "none"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max"
		| undefined;
	reasoning_max_tokens: number | undefined;
	prompt_cache_key: string | undefined;
	prompt_cache_retention: PromptCacheRetention | undefined;
	prompt_cache_options: PromptCacheOptions | undefined;
	session_id: string | undefined;
	effort: "low" | "medium" | "high" | undefined;
	webSearchTool: WebSearchTool | undefined;
	image_config:
		| {
				aspect_ratio?: string;
				image_size?: string;
				image_quality?: string;
				n?: number;
				seed?: number;
		  }
		| undefined;
	sensitive_word_check: { status: "DISABLE" | "ENABLE" } | undefined;
	maxImageSizeMB: number;
	userPlan: "free" | "pro" | "enterprise" | null;
	hasExistingToolCalls: boolean;
	customProviderName: string | undefined;
	excludedEnvKeyIndices?: ReadonlySet<number>;
	excludedProviderKeyIds?: ReadonlySet<string>;
	n?: number;
	providerCacheControlMode: ProviderCacheControlMode;
	service_tier?: "auto" | "default" | "flex" | "priority";
	/**
	 * The premium tier the client asked for itself, or null when `service_tier`
	 * only carries an org-level default. A client-requested tier is strict: a
	 * candidate that cannot serve it is rejected rather than downgraded, so the
	 * retry loop moves on instead of quietly serving standard.
	 */
	clientRequestedServiceTier?: "flex" | "priority" | null;
	verbosity?: "low" | "medium" | "high";
}

interface ProjectInfo {
	mode: string;
	organizationId: string;
}

interface OrgInfo {
	id: string;
	/** Opaque per-org identifier forwarded to providers for abuse attribution. */
	safetyIdentifier: string;
	credits: string | null;
	plan: string;
	kind: string;
	devPlan: string;
	devPlanPaygEnabled: boolean;
	devPlanCreditsLimit: string | null;
	devPlanCreditsUsed: string | null;
	devPlanPremiumCreditsUsed: string | null;
	devPlanPremiumWeekStart: Date | null;
	devPlanExpiresAt: Date | null;
	chatPlan: string;
	chatPlanCreditsLimit: string | null;
	chatPlanCreditsUsed: string | null;
	chatPlanExpiresAt: Date | null;
}

export interface AvailableCredits {
	regularCredits: number;
	devPlanCreditsRemaining: number;
	chatPlanCreditsRemaining: number;
	totalAvailableCredits: number;
}

/**
 * Computes the credit pools a request may draw on. For dev-plan (DevPass)
 * orgs the regular PAYG `credits` balance only counts once the org has
 * opted into pay-as-you-go overflow (devPlanPaygEnabled); without the
 * opt-in the plan allowance is a hard cap, even if the org somehow holds
 * a credits balance (e.g. an admin gift).
 */
export function getAvailableCredits(
	organization: Pick<
		OrgInfo,
		| "credits"
		| "devPlan"
		| "devPlanPaygEnabled"
		| "devPlanCreditsLimit"
		| "devPlanCreditsUsed"
		| "chatPlan"
		| "chatPlanCreditsLimit"
		| "chatPlanCreditsUsed"
	>,
): AvailableCredits {
	const paygBalance = parseFloat(organization.credits ?? "0");
	const regularCredits =
		organization.devPlan === "none" || organization.devPlanPaygEnabled
			? paygBalance
			: 0;
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
		regularCredits,
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits:
			regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining,
	};
}

/**
 * The 402 thrown when a dev-plan org exhausts its monthly allowance. The
 * hint tells opted-in orgs their PAYG balance is empty and everyone else
 * that overflow exists — the moment this error fires is the moment that
 * information is actionable.
 *
 * An org that already holds a balance it cannot spend (an admin credit gift,
 * a referral bonus, credits left over from before it subscribed) is told the
 * amount: without it the generic "enable overflow" nudge reads as "go spend
 * more money" and the credits sit unused, which is exactly the case gifting
 * credits to a maxed-out subscriber is meant to solve.
 */
export function buildDevPlanCreditLimitError(
	organization: Pick<
		OrgInfo,
		"credits" | "devPlanPaygEnabled" | "devPlanExpiresAt"
	>,
	messagePrefix = "",
): HTTPException {
	const renewalDate = organization.devPlanExpiresAt
		? new Date(organization.devPlanExpiresAt).toLocaleDateString()
		: "your next billing date";
	const waitingBalance = parseFloat(organization.credits ?? "0");
	const paygHint = organization.devPlanPaygEnabled
		? " Your pay-as-you-go balance is empty — top up credits from your DevPass dashboard to keep going."
		: waitingBalance > 0
			? ` You have $${waitingBalance.toFixed(2)} in credits waiting — enable pay-as-you-go overflow in your DevPass dashboard to spend them.`
			: " Or enable pay-as-you-go overflow in your DevPass dashboard to keep going past your allowance.";
	return new HTTPException(402, {
		message: `${messagePrefix}Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.${paygHint}`,
	});
}

/**
 * Throws when a DevPass subscriber has exhausted the weekly fair-use
 * allowance for premium-tier models. No-op for non-DevPass orgs and
 * non-premium models.
 *
 * trackRejection must only be true at request-entry gates. The env-fallback
 * call sites below run inside provider retry loops that swallow this throw
 * (tryResolveAlternateKeyForCurrentProvider catches and returns null), so
 * tracking there would emit one event per fallback candidate — including for
 * requests that ultimately succeed on another key.
 */
export function assertDevPlanPremiumCapNotExceeded(
	organization: Pick<
		OrgInfo,
		| "id"
		| "credits"
		| "devPlan"
		| "devPlanPaygEnabled"
		| "devPlanCreditsLimit"
		| "devPlanCreditsUsed"
		| "devPlanPremiumCreditsUsed"
		| "devPlanPremiumWeekStart"
		| "chatPlan"
		| "chatPlanCreditsLimit"
		| "chatPlanCreditsUsed"
	>,
	modelInfo: Pick<ModelDefinition, "id">,
	trackRejection = false,
): void {
	if (organization.devPlan === "none") {
		return;
	}
	if (!isPremiumModel(modelInfo.id)) {
		return;
	}
	const tier = organization.devPlan as DevPlanTier;
	const remaining = getRemainingPremiumWeeklyAllowance(
		tier,
		organization.devPlanPremiumCreditsUsed,
		organization.devPlanPremiumWeekStart,
	);
	if (remaining > 0) {
		return;
	}
	// PAYG overflow: the weekly premium cap is a fair-use limiter on the plan
	// allowance, not on the org's own money. An opted-in org gets premium
	// requests admitted past the cap whenever overflow can actually pay:
	// either the monthly pool is already exhausted (the regular credit gate
	// downstream takes over), or the org holds a positive credits balance —
	// in which case the worker routes the over-cap premium spend to that
	// balance at provider rates, so the plan pool still never pays past the
	// cap and Reset Passes remain the way to keep premium usage inside the
	// plan. Opted in with an empty balance mid-cycle, the cap still bites.
	if (organization.devPlanPaygEnabled) {
		const { regularCredits, devPlanCreditsRemaining } =
			getAvailableCredits(organization);
		if (devPlanCreditsRemaining <= 0 || regularCredits > 0) {
			return;
		}
	}
	const weekStart = organization.devPlanPremiumWeekStart
		? new Date(organization.devPlanPremiumWeekStart)
		: new Date();
	const resetAt = new Date(
		weekStart.getTime() + DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	);
	const msUntilReset = Math.max(0, resetAt.getTime() - Date.now());
	// Every rejected request is a sized signal of Reset Pass demand: the
	// dashboard's devpass_weekly_cap_hit_viewed only fires when the user
	// opens the dashboard, but most cap hits happen inside a coding agent
	// that swallows this 402 — without this event the funnel undercounts.
	// $process_person_profile: false — the distinct id is an org id, not a
	// user; don't mint a person profile for it.
	if (trackRejection) {
		try {
			posthog.capture({
				distinctId: organization.id,
				event: "devpass_premium_cap_rejected",
				groups: { organization: organization.id },
				properties: {
					devPlan: tier,
					model: modelInfo.id,
					msUntilReset,
					organization: organization.id,
					$process_person_profile: false,
				},
			});
		} catch {
			// Telemetry must never change the response: the 402 below is a
			// billing gate, and a capture failure must not turn it into a 500.
		}
	}
	// Reaching here with the opt-in means the balance is empty, so a top-up is
	// the one action that unblocks premium immediately.
	const paygHint = organization.devPlanPaygEnabled
		? " Pay-as-you-go overflow is enabled but your credits balance is empty — top up from your DevPass dashboard to keep premium models flowing."
		: "";
	throw new HTTPException(402, {
		message: `You've used your weekly allowance for premium-tier models on the ${tier} plan. Redeem a Reset Pass from your dashboard for an instant reset, upgrade for a higher allowance, or use any standard model now. Resets in ${formatTimeUntilReset(msUntilReset)}.${paygHint}`,
	});
}

/**
 * Formats a duration as "N days and M hours", dropping zero components and
 * rounding up to the next hour so the wait is never understated.
 */
export function formatTimeUntilReset(ms: number): string {
	if (ms < 60 * 60 * 1000) {
		return "less than an hour";
	}
	const totalHours = Math.ceil(ms / (60 * 60 * 1000));
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	const parts: string[] = [];
	if (days > 0) {
		parts.push(`${days} day${days === 1 ? "" : "s"}`);
	}
	if (hours > 0) {
		parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
	}
	return parts.join(" and ");
}

// Mirrors the initial credit gate in chat.ts so retry/fallback paths that
// switch to LLMGateway env-var tokens cannot be used to bill an organization
// with non-positive credits. Free models (explicitly flagged in the catalog)
// are exempt.
function assertOrganizationHasCreditsForEnvFallback(
	organization: OrgInfo,
	modelInfo: ModelDefinition,
	sponsoredOnboarding = false,
): void {
	if (modelInfo.free) {
		return;
	}
	assertDevPlanPremiumCapNotExceeded(organization, modelInfo);
	const {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits,
	} = getAvailableCredits(organization);
	if (totalAvailableCredits > 0) {
		return;
	}
	if (
		organization.chatPlan !== "none" &&
		chatPlanCreditsRemaining <= 0 &&
		devPlanCreditsRemaining <= 0
	) {
		const renewalDate = organization.chatPlanExpiresAt
			? new Date(organization.chatPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: `Chat Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		});
	}
	if (organization.devPlan !== "none" && devPlanCreditsRemaining <= 0) {
		throw buildDevPlanCreditLimitError(organization);
	}
	// Matches chat.ts: sponsorship waives only the plain zero-balance case, never
	// the plan allowances asserted above.
	if (sponsoredOnboarding) {
		return;
	}
	throw new HTTPException(402, {
		message: `Organization ${organization.id} has insufficient credits`,
	});
}

export { formatUsedModelForDisplay } from "@/lib/model-response-id.js";

/**
 * Which of an organization's own keys may serve a given model.
 *
 * Skips BYOK keys whose allowedModels restriction excludes the model being
 * served, so a key that cannot satisfy the request upstream is never picked
 * over a sibling key (or the credits fallback in hybrid mode) that can, and
 * layers on the service-tier filter when the request asks for a premium tier.
 *
 * Shared with the routing metadata so the "your keys" list can never disagree
 * with the set the gateway actually chose from. Custom provider keys are
 * exempt: their catalog already scopes them.
 */
export function buildByokKeyFilter(
	usedInternalModel: string,
	serviceTierKeyFilter?: (
		key: InferSelectModel<typeof tables.providerKey>,
	) => boolean,
): (key: InferSelectModel<typeof tables.providerKey>) => boolean {
	return (key) =>
		providerKeyAllowsModel(key.allowedModels, usedInternalModel) &&
		(serviceTierKeyFilter ? serviceTierKeyFilter(key) : true);
}

/**
 * The organization's own keys that could have served this provider and model,
 * in selection order, named the way their owner sees them.
 *
 * Only BYOK-capable modes have candidates: a credits-mode project routes on
 * platform credentials, which are never listed. Custom providers are excluded
 * because their keys are looked up by provider name through a different query,
 * so the list would not describe the same candidate set.
 */
export async function resolveEligibleProviderKeys(args: {
	projectMode: string;
	organizationId: string;
	provider: string;
	usedInternalModel: string;
	serviceTierKeyFilter?: (
		key: InferSelectModel<typeof tables.providerKey>,
	) => boolean;
}): Promise<Array<{ id: string; label?: string }> | undefined> {
	if (
		(args.projectMode !== "api-keys" && args.projectMode !== "hybrid") ||
		args.provider === "custom"
	) {
		return undefined;
	}

	const keys = await listEligibleProviderKeys(
		args.organizationId,
		args.provider,
		buildByokKeyFilter(args.usedInternalModel, args.serviceTierKeyFilter),
	);

	if (keys.length === 0) {
		return undefined;
	}

	return keys.map((key) => ({ id: key.id, label: providerKeyLabel(key) }));
}

/**
 * Resolves all provider-dependent context needed to make a fetch request.
 * This includes token resolution, URL building, parameter stripping,
 * request body preparation, and header construction.
 *
 * Used by the retry loop to quickly set up a new provider context on fallback.
 */
export async function resolveProviderContext(
	providerMapping: { providerId: string; externalId: string; region?: string },
	project: ProjectInfo,
	organization: OrgInfo,
	modelInfo: ModelDefinition,
	originalParams: OriginalRequestParams,
	options: ProviderContextOptions,
): Promise<ProviderContext> {
	const usedProvider = providerMapping.providerId as Provider;
	// The upstream model id (sent verbatim to the provider API). For BYOK
	// Azure deployments this is overridden by `azure_deployment_name` below.
	const usedExternalId = providerMapping.externalId;
	// The canonical LLM Gateway model id (used for everything internal:
	// pricing, discounts, rate limits, IAM, key selection, logging display).
	// `modelInfo.id` falls back to `usedExternalId` only for custom providers,
	// which have no entry in the registry.
	const usedInternalModel = modelInfo.id || usedExternalId;
	// `usedModelMapping` is the log column that stores the raw upstream id.
	const usedModelMapping = usedExternalId;
	const usedModelFormatted = formatUsedModelForDisplay(
		usedProvider,
		usedInternalModel,
		options.customProviderName,
		providerMapping.region,
	);

	// --- Token resolution ---
	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let managedKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;

	// Which env-var variant (`__ENTERPRISE` / `__PLANS` overrides) applies to
	// this org's env-credential reads. Undefined = base vars only.
	const envVariant = getLicensedOrganizationEnvVariant(organization);

	// Flex/Priority is only honored when the request reaches the provider's real
	// upstream endpoint on a tier-capable location. Skip provider keys whose
	// custom base URL (proxy) may silently drop the tier, and Vertex keys pinned
	// to a regional endpoint, so a compliant key (or the managed env credential)
	// is used instead. This is what keeps an alternate-key retry from rotating a
	// Flex request onto a credential that would serve it as standard.
	const serviceTierKeyFilter = isPremiumServiceTier(options.service_tier)
		? providerKeySupportsServiceTier
		: undefined;

	const byokKeyFilter = buildByokKeyFilter(
		usedInternalModel,
		serviceTierKeyFilter,
	);

	const eligibleProviderKeys = await resolveEligibleProviderKeys({
		projectMode: project.mode,
		organizationId: project.organizationId,
		provider: usedProvider,
		usedInternalModel,
		serviceTierKeyFilter,
	});

	if (project.mode === "api-keys") {
		if (usedProvider === "custom" && options.customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				options.customProviderName,
				usedInternalModel,
				options.excludedProviderKeyIds,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				usedInternalModel,
				options.excludedProviderKeyIds,
				byokKeyFilter,
			);
		}

		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${usedProvider}`,
			});
		}

		usedToken = readProviderKey(providerKey);
	} else if (project.mode === "credits") {
		assertOrganizationHasCreditsForEnvFallback(
			organization,
			modelInfo,
			options.sponsoredOnboarding,
		);
		const platformCredential = await resolvePlatformCredential(
			usedProvider as Provider,
			{
				selectionScope: usedInternalModel,
				model: usedInternalModel,
				variant: envVariant,
				region: providerMapping.region,
				requiresServiceTier: serviceTierKeyFilter !== undefined,
				excludedEnvIndices: options.excludedEnvKeyIndices,
				excludedProviderKeyIds: options.excludedProviderKeyIds,
			},
		);
		managedKey = platformCredential.managedKey;
		usedToken = platformCredential.token;
		configIndex = platformCredential.configIndex;
		envVarName = platformCredential.envVarName;
	} else if (project.mode === "hybrid") {
		if (usedProvider === "custom" && options.customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				options.customProviderName,
				usedInternalModel,
				options.excludedProviderKeyIds,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				usedInternalModel,
				options.excludedProviderKeyIds,
				byokKeyFilter,
			);
		}

		if (providerKey) {
			usedToken = readProviderKey(providerKey);
		} else {
			assertOrganizationHasCreditsForEnvFallback(
				organization,
				modelInfo,
				options.sponsoredOnboarding,
			);
			const platformCredential = await resolvePlatformCredential(
				usedProvider as Provider,
				{
					selectionScope: usedInternalModel,
					model: usedInternalModel,
					variant: envVariant,
					region: providerMapping.region,
					requiresServiceTier: serviceTierKeyFilter !== undefined,
					excludedEnvIndices: options.excludedEnvKeyIndices,
					excludedProviderKeyIds: options.excludedProviderKeyIds,
				},
			);
			managedKey = platformCredential.managedKey;
			usedToken = platformCredential.token;
			configIndex = platformCredential.configIndex;
			envVarName = platformCredential.envVarName;
		}
	}

	if (!usedToken) {
		throw new HTTPException(500, { message: "No token" });
	}

	// --- Look up the specific provider mapping for the selected provider ---
	// `modelInfo.providers` is region-expanded only when a provider was explicitly
	// requested; for unpinned routing it holds just the region-agnostic root
	// mapping (`region: undefined`) while `usedRegion` is a concrete value
	// (e.g. AWS Bedrock's `global`). Resolve via the shared fallback helper so a
	// retry/alternate-key request keeps reasoning support instead of dropping it.
	const usedRegion = providerMapping.region;
	const providerMappingForSelected = selectProviderMapping(
		modelInfo.providers,
		usedProvider,
		usedRegion,
	);

	// --- Region validation ---
	// Validate against the expanded model-provider mapping (which contains per-model region info)
	// rather than the provider-level catalog (which lists all regions the provider supports).
	if (usedRegion) {
		const modelRegions = modelInfo.providers
			.filter((p) => p.providerId === usedProvider)
			.map((p) => p.region)
			.filter(Boolean) as string[];
		if (modelRegions.length > 0 && !modelRegions.includes(usedRegion)) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} is not available in region "${usedRegion}". Available regions: ${modelRegions.join(", ")}`,
			});
		}
	}

	// Override with region-specific env var if a non-default region is selected
	// (credits/hybrid mode). Managed credentials are already selected per
	// region, so this only applies to the env-var path. Health attribution must
	// follow the credential we actually send.
	if (usedRegion && !providerKey && !managedKey) {
		const regionEnvVarName = getRegionSpecificEnvVarName(
			usedProvider,
			usedRegion,
			envVariant,
		);
		if (regionEnvVarName) {
			const regionToken = process.env[regionEnvVarName];
			if (regionToken) {
				usedToken = regionToken;
				envVarName = regionEnvVarName;
				configIndex = 0;
			}
		}
	}

	// The tier this attempt will actually be sent at. Resolved here — after the
	// provider, region and credential are known — because a fallback attempt
	// picks its own, and a mapping/credential that cannot carry the tier would
	// otherwise be served (and billed) as standard without the caller knowing.
	// Throwing rejects this candidate: the retry loop treats a context-resolution
	// failure as "try the next provider/key".
	const forwardedServiceTier = getForwardedServiceTier(
		usedInternalModel,
		usedProvider,
		usedRegion,
		options.service_tier,
		configIndex,
		envVariant,
	);
	assertServiceTierHonored({
		clientRequestedServiceTier: options.clientRequestedServiceTier ?? null,
		forwardedServiceTier,
		provider: usedProvider,
		model: usedInternalModel,
		region: usedRegion,
	});

	const usedApiKeyHash = getApiKeyFingerprint(usedToken);

	// --- Check if model supports reasoning (from selected provider, not any) ---
	const supportsReasoning = providerMappingForSelected?.reasoning === true;
	const splitTaggedReasoning =
		providerMappingForSelected?.splitTaggedReasoning === true;
	const healStreamingJsonOutput =
		providerMappingForSelected?.healStreamingJsonOutput === true;

	// --- Image generation check ---
	const isImageGeneration =
		providerMappingForSelected?.imageGenerations === true;

	// When a database-backed credential is used — the organization's BYOK key
	// or the platform-managed credential — env vars are skipped entirely. Only
	// that credential's own settings and the hardcoded provider defaults apply.
	const isBYOK = providerKey !== undefined;
	const usesDatabaseCredential = isBYOK || managedKey !== undefined;
	const credentialOptions = isBYOK
		? (providerKey?.options ?? undefined)
		: managedCredentialOptions(managedKey);
	const credentialBaseUrl = isBYOK
		? (providerKey?.baseUrl ?? undefined)
		: undefined;

	// Apply azure_deployment_name override (if set) to the upstream model
	// name. Must run after providerKey is resolved so retry fallbacks also
	// pick up the override.
	const azureDeploymentName =
		usedProvider === "azure"
			? credentialOptions?.azure_deployment_name
			: undefined;
	const upstreamModelName = azureDeploymentName || usedExternalId;

	// --- URL resolution ---
	// Resolve the Google Vertex token type once and feed it to both the endpoint
	// (`?key=` query param) and the headers (`Authorization: Bearer`) so they
	// never disagree. There is no region-env override here for database-backed
	// credentials (the override above only runs when neither is set), so
	// `usesDatabaseCredential` correctly reflects whether the DB key is active.
	const vertexTokenType: VertexTokenType | undefined =
		usedProvider === "google-vertex"
			? resolveVertexTokenType(
					usedProvider,
					credentialOptions,
					configIndex,
					usesDatabaseCredential,
					envVariant,
				)
			: undefined;
	const url = getProviderEndpoint(
		options.airsideCustomBaseUrl ? "custom" : (usedProvider as Provider),
		options.airsideCustomBaseUrl ?? credentialBaseUrl,
		upstreamModelName,
		usedProvider === "google-ai-studio" ||
			usedProvider === "glacier" ||
			usedProvider === "google-vertex" ||
			usedProvider === "quartz" ||
			usedProvider === "vertex-anthropic"
			? usedToken
			: undefined,
		options.stream,
		supportsReasoning,
		options.hasExistingToolCalls,
		credentialOptions,
		configIndex,
		isImageGeneration,
		usedRegion,
		usesDatabaseCredential,
		usedInternalModel,
		vertexTokenType,
		envVariant,
	);

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}`,
		});
	}

	const useResponsesApi = url.includes("/responses");

	// --- Parameter stripping ---
	// Work with copies of original params to avoid mutation
	let temperature = originalParams.temperature;
	let max_tokens = originalParams.max_tokens;
	let top_p = originalParams.top_p;
	let frequency_penalty = originalParams.frequency_penalty;
	let presence_penalty = originalParams.presence_penalty;

	const strippedParameters: string[] = [];
	if (providerMappingForSelected) {
		const supported = providerMappingForSelected.supportedParameters;
		if (supported && supported.length > 0) {
			if (temperature !== undefined && !supported.includes("temperature")) {
				temperature = undefined;
				strippedParameters.push("temperature");
			}
			if (top_p !== undefined && !supported.includes("top_p")) {
				top_p = undefined;
				strippedParameters.push("top_p");
			}
			if (
				frequency_penalty !== undefined &&
				!supported.includes("frequency_penalty")
			) {
				frequency_penalty = undefined;
				strippedParameters.push("frequency_penalty");
			}
			if (
				presence_penalty !== undefined &&
				!supported.includes("presence_penalty")
			) {
				presence_penalty = undefined;
				strippedParameters.push("presence_penalty");
			}
			if (max_tokens !== undefined && !supported.includes("max_tokens")) {
				max_tokens = undefined;
				strippedParameters.push("max_tokens");
			}
		}
	}

	// Anthropic does not allow temperature and top_p simultaneously
	if (
		usedProvider === "anthropic" ||
		usedProvider === "vertex-anthropic" ||
		usedProvider === "azure-anthropic"
	) {
		if (temperature !== undefined && top_p !== undefined) {
			top_p = undefined;
		}
	}

	temperature = clampTemperature(
		temperature,
		usedProvider,
		providerMappingForSelected?.maxTemperature,
	);

	// --- max_tokens validation ---
	if (max_tokens !== undefined && providerMappingForSelected) {
		const effectiveMaxOutput = providerMappingForSelected.maxOutput;
		if (effectiveMaxOutput !== undefined) {
			if (max_tokens > effectiveMaxOutput) {
				throw new HTTPException(400, {
					message: `The requested max_tokens (${max_tokens}) exceeds the maximum output tokens allowed for model ${usedInternalModel} (${effectiveMaxOutput})`,
				});
			}
		}
	}

	// --- n parameter validation ---
	// Mirror the initial-path supportsN/maxN/supportsNStreaming checks
	// (chat.ts) so retry fallbacks don't silently drop n by routing to a
	// mapping that doesn't natively accept multiple choices.
	if (options.n !== undefined && options.n > 1) {
		if (!providerMappingForSelected?.supportsN) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} does not support the n parameter for multiple choices. Send n separate requests instead.`,
			});
		}
		if (
			providerMappingForSelected.maxN !== undefined &&
			options.n > providerMappingForSelected.maxN
		) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} supports at most ${providerMappingForSelected.maxN} choices per request (n <= ${providerMappingForSelected.maxN}).`,
			});
		}
		if (
			options.effectiveStream &&
			providerMappingForSelected.supportsNStreaming === false
		) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} does not support the n parameter for multiple choices with streaming. Send a non-streaming request instead.`,
			});
		}
	}

	// --- requestCanBeCanceled ---
	const requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	// --- Request body preparation ---
	const requestBody: ProviderRequestBody | FormData = await prepareRequestBody(
		usedProvider as Provider,
		usedInternalModel,
		providerMapping.region ?? null,
		upstreamModelName,
		options.messages as BaseMessage[],
		options.effectiveStream,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		options.response_format,
		options.tools,
		options.tool_choice,
		options.reasoning_effort,
		supportsReasoning,
		process.env.NODE_ENV === "production",
		options.maxImageSizeMB,
		options.userPlan,
		options.sensitive_word_check,
		options.image_config,
		options.effort,
		isImageGeneration,
		options.webSearchTool,
		options.reasoning_max_tokens,
		useResponsesApi,
		options.prompt_cache_key,
		options.prompt_cache_retention,
		options.providerCacheControlMode,
		options.n,
		forwardedServiceTier,
		options.verbosity,
		options.prompt_cache_options,
		options.session_id,
		undefined,
		organization.safetyIdentifier,
	);

	// Post-validation of max_tokens in request body
	if (
		!(requestBody instanceof FormData) &&
		hasMaxTokens(requestBody) &&
		requestBody.max_tokens !== undefined &&
		providerMappingForSelected
	) {
		if (
			"maxOutput" in providerMappingForSelected &&
			providerMappingForSelected.maxOutput !== undefined
		) {
			if (requestBody.max_tokens > providerMappingForSelected.maxOutput) {
				throw new HTTPException(400, {
					message: `The effective max_tokens (${requestBody.max_tokens}) exceeds the maximum output tokens allowed for model ${usedInternalModel} (${providerMappingForSelected.maxOutput})`,
				});
			}
		}
	}

	// Vertex's OpenAI-compatible endpoint requires an OAuth2 access token
	// derived from the configured service account JSON. The SA JSON is the
	// long-lived credential (kept in usedApiKeyHash above for health tracking)
	// while the short-lived access token is what travels in the Authorization
	// header — so swap usedToken here so downstream header builders just work.
	// Read the env var directly to bypass round-robin comma-splitting (an SA
	// JSON value contains commas and would otherwise be truncated).
	if (usedProvider === "vertex-openai") {
		const fullSaJson = usesDatabaseCredential
			? usedToken
			: (process.env[
					getVariantEnvVarNameFor(
						"LLM_VERTEX_OPENAI_SERVICE_ACCOUNT_JSON",
						envVariant,
					) ?? "LLM_VERTEX_OPENAI_SERVICE_ACCOUNT_JSON"
				] ?? "");
		usedToken = await getGcpServiceAccountAccessToken(fullSaJson);
	}

	// --- Headers ---
	const headers = getProviderHeaders(usedProvider as Provider, usedToken, {
		requestId: options.requestId,
		tokenType: vertexTokenType,
	});
	headers["Content-Type"] = "application/json";

	if (usedProvider === "anthropic" && options.effort !== undefined) {
		const currentBeta = headers["anthropic-beta"];
		headers["anthropic-beta"] = currentBeta
			? `${currentBeta},effort-2025-11-24`
			: "effort-2025-11-24";
	}

	if (
		usedProvider === "anthropic" &&
		options.response_format?.type === "json_schema"
	) {
		const currentBeta = headers["anthropic-beta"];
		headers["anthropic-beta"] = currentBeta
			? `${currentBeta},structured-outputs-2025-11-13`
			: "structured-outputs-2025-11-13";
	}

	return {
		usedProvider,
		usedInternalModel,
		usedExternalId,
		usedModelFormatted,
		usedModelMapping,
		usedToken,
		usedApiKeyHash,
		providerKey,
		managedKey,
		trackedKeyHealthId: providerKey?.id ?? managedKey?.id,
		configIndex,
		envVarName,
		url,
		requestBody,
		useResponsesApi,
		requestCanBeCanceled,
		isImageGeneration,
		supportsReasoning,
		splitTaggedReasoning,
		healStreamingJsonOutput,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		strippedParameters,
		headers,
		usedRegion,
		eligibleProviderKeys,
	};
}
