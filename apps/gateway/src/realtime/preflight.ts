import { createHash } from "node:crypto";

import { HTTPException } from "hono/http-exception";

import { resolvePlatformCredential } from "@/chat/tools/resolve-platform-credential.js";
import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	assertApiKeyWithinUsageLimits,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
	type GatewayApiKey,
} from "@/lib/cached-queries.js";
import { assertProviderCompliant } from "@/lib/compliance.js";
import { getLicensedOrganizationEnvVariant } from "@/lib/enterprise.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { getOrganizationBlockReason } from "@/lib/organization-access.js";

import { readProviderKey } from "@llmgateway/actions";

import {
	findRealtimeMapping,
	listRealtimeTranscriptionMappings,
	type RealtimeMappingMatch,
} from "./catalog.js";
import { RealtimeConnectError } from "./errors.js";

import type { InferSelectModel, tables } from "@llmgateway/db";
import type { EnvVarVariant, Provider } from "@llmgateway/models";

type Organization = InferSelectModel<typeof tables.organization>;
type Project = InferSelectModel<typeof tables.project>;
type ProviderKey = InferSelectModel<typeof tables.providerKey>;

export interface RealtimePreflightInput {
	token: string | undefined;
	requestedModel: string | undefined;
	clientIp?: string;
}

export interface RealtimePreflightResult {
	apiKey: GatewayApiKey;
	project: Project;
	organization: Organization;
	match: RealtimeMappingMatch;
	providerKey: ProviderKey | undefined;
	/**
	 * Platform-managed credential serving this credits-mode session, when one
	 * is configured: the database-backed replacement for the provider's `LLM_*`
	 * env vars. Distinct from `providerKey`, which is always the organization's
	 * own BYOK key — a managed credential still bills as `credits`.
	 */
	managedKey: ProviderKey | undefined;
	/**
	 * Provider-key id to attribute upstream health failures to, following the
	 * credential actually sent: the BYOK key or the managed credential.
	 */
	trackedKeyHealthId: string | undefined;
	upstreamToken: string;
	usedApiKeyHash: string;
	envVarName: string | undefined;
	configIndex: number;
	/** Env-var variant the organization maps to, for env-backed settings reads. */
	envVariant: EnvVarVariant | undefined;
	usedMode: "api-keys" | "credits";
	/**
	 * Canonical ids of the input-audio transcription models this API key's IAM
	 * rules allow on the session's provider. Input transcription is billable
	 * work on a separate model, so it has to clear the same per-key IAM rules
	 * (allowed models, price ceilings, IP ranges) as the realtime model itself.
	 */
	allowedTranscriptionModelIds: string[];
	/**
	 * Originating client IP of the connection, retained so per-generation gates
	 * can re-evaluate IP-scoped IAM rules.
	 */
	clientIp: string | undefined;
	/**
	 * Stable, privacy-preserving end-user identifier forwarded upstream via the
	 * OpenAI-Safety-Identifier header (a hash, never a raw internal id).
	 */
	safetyIdentifier: string;
}

/**
 * Derive the opaque `OpenAI-Safety-Identifier` for a session. It is keyed on the
 * tenant (organization + project) rather than on the API key: keys are rotatable
 * credentials, so deriving from one would reset the upstream abuse-tracking
 * identity on every rotation, and no part of a credential should ever be fed
 * into a fast digest. Both ids are 20-character CSPRNG nanoids (~119 bits each),
 * so a plain digest needs no salt or pepper: there is no small input space to
 * enumerate, and the hash exists only to keep internal ids off the wire.
 */
function deriveSafetyIdentifier(
	organizationId: string,
	projectId: string,
): string {
	return createHash("sha256")
		.update(`realtime-safety-identifier:${organizationId}:${projectId}`)
		.digest("hex")
		.slice(0, 32);
}

export function getAvailableCredits(organization: Organization): number {
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
	return regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining;
}

function toConnectError(error: unknown): RealtimeConnectError {
	if (error instanceof RealtimeConnectError) {
		return error;
	}
	if (error instanceof HTTPException) {
		return new RealtimeConnectError(
			error.status,
			"request_rejected",
			error.message,
		);
	}
	throw error;
}

/**
 * Validate the LLMGateway credential, project, organization, model and
 * upstream credential before completing a realtime WebSocket upgrade. Throws
 * RealtimeConnectError with an HTTP status so the upgrade handler can reject
 * the socket with a proper HTTP response instead of opening the session.
 */
export async function runRealtimePreflight(
	input: RealtimePreflightInput,
): Promise<RealtimePreflightResult> {
	try {
		return await runRealtimePreflightInner(input);
	} catch (error) {
		throw toConnectError(error);
	}
}

async function runRealtimePreflightInner(
	input: RealtimePreflightInput,
): Promise<RealtimePreflightResult> {
	if (!input.token) {
		throw new RealtimeConnectError(
			401,
			"missing_api_key",
			"Unauthorized: No API key provided. Expected 'Authorization: Bearer your-api-token' header.",
		);
	}
	if (!input.requestedModel) {
		throw new RealtimeConnectError(
			400,
			"missing_model",
			"Missing required 'model' query parameter, e.g. /v1/realtime?model=gpt-realtime.",
		);
	}

	const match = findRealtimeMapping(input.requestedModel);
	if (!match) {
		throw new RealtimeConnectError(
			400,
			"model_not_found",
			`Realtime model not found: ${input.requestedModel}`,
		);
	}
	// Provider-scoped kill switch. Enforced here so it covers both client-secret
	// minting and the WebSocket upgrade with the same normal 503, instead of a
	// mint succeeding and the upgrade failing opaquely.
	if (
		match.mapping.providerId === "google-ai-studio" &&
		process.env.REALTIME_GEMINI_DISABLED === "true"
	) {
		throw new RealtimeConnectError(
			503,
			"realtime_gemini_disabled",
			"Gemini realtime sessions are temporarily unavailable.",
		);
	}

	const apiKey = await findApiKeyByToken(input.token);
	if (!apiKey) {
		throw new RealtimeConnectError(
			401,
			"invalid_api_key",
			"Unauthorized: Invalid LLMGateway API token. The token could not be found. Go to the LLMGateway 'API Keys' page to generate a new token.",
		);
	}
	if (apiKey.status !== "active") {
		throw new RealtimeConnectError(
			401,
			"inactive_api_key",
			"Unauthorized: This LLMGateway API token is not active (it may be disabled or deleted).",
		);
	}
	// End-user session tokens (LLM SDK) and platform keys are deferred for
	// realtime: their wallet-substitution billing path is not wired up here.
	if (apiKey.keyType !== "user" || apiKey.endUserSession) {
		throw new RealtimeConnectError(
			403,
			"unsupported_key_type",
			"Realtime sessions currently require a regular developer API key. End-user session tokens and platform keys are not supported yet.",
		);
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new RealtimeConnectError(
			500,
			"project_not_found",
			"Could not find project",
		);
	}
	if (project.status === "deleted") {
		throw new RealtimeConnectError(
			410,
			"project_archived",
			"Project has been archived and is no longer accessible",
		);
	}

	await assertMemberWithinBudget(apiKey.createdBy, project.organizationId);
	assertApiKeyWithinUsageLimits(apiKey);

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new RealtimeConnectError(
			500,
			"organization_not_found",
			"Could not find organization",
		);
	}
	const organizationBlocked = getOrganizationBlockReason(organization);
	if (organizationBlocked) {
		throw new RealtimeConnectError(
			organizationBlocked.status,
			organizationBlocked.status === 403
				? "organization_high_risk"
				: "organization_disabled",
			organizationBlocked.message,
		);
	}
	// Dev-plan and chat-plan credit pools are deferred: realtime v1 bills
	// regular PAYG credits or BYOK keys only.
	if (organization.kind !== "default") {
		throw new RealtimeConnectError(
			403,
			"unsupported_plan",
			"Realtime sessions are not available for coding or chat plan organizations. Use a regular pay-as-you-go organization.",
		);
	}

	const providerId = match.mapping.providerId;

	const iamValidation = await validateRequestModelAccess({
		apiKey,
		organizationId: project.organizationId,
		requestedModel: match.modelId,
		requestedProvider: providerId,
		activeModelInfo: match.modelDef,
		clientIp: input.clientIp,
	});
	if (!iamValidation.allowed) {
		try {
			throwIamException(iamValidation.reason ?? "Model access denied");
		} catch (error) {
			throw toConnectError(error);
		}
		// Defense in depth: never fall through to credential resolution if
		// throwIamException ever stops throwing.
		throw new RealtimeConnectError(
			403,
			"model_access_denied",
			iamValidation.reason ?? "Model access denied",
		);
	}

	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: match.modelId,
		apiKeyId: apiKey.id,
		model: input.requestedModel,
	});

	// Input transcription bills a second model, so resolve up front which ASR
	// mappings this key may actually use. Doing it here (rather than per
	// session.update) keeps the protocol path synchronous and means a key
	// restricted by model, price or IP cannot reach a pricier ASR model.
	const allowedTranscriptionModelIds: string[] = [];
	for (const candidate of listRealtimeTranscriptionMappings(providerId)) {
		const validation = await validateRequestModelAccess({
			apiKey,
			organizationId: project.organizationId,
			requestedModel: candidate.modelId,
			requestedProvider: providerId,
			activeModelInfo: candidate.modelDef,
			clientIp: input.clientIp,
		});
		if (validation.allowed) {
			allowedTranscriptionModelIds.push(candidate.modelId);
		}
	}

	// --- Upstream credential resolution (mirrors the embeddings path) ---
	let providerKey: ProviderKey | undefined;
	let managedKey: ProviderKey | undefined;
	let upstreamToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;
	const envVariant = getLicensedOrganizationEnvVariant(organization);

	const resolveCredits = async () => {
		const platformCredential = await resolvePlatformCredential(
			providerId as Provider,
			{
				selectionScope: match.modelId,
				variant: envVariant,
				region: undefined,
				requiresServiceTier: false,
			},
		);
		managedKey = platformCredential.managedKey;
		upstreamToken = platformCredential.token;
		configIndex = platformCredential.configIndex;
		envVarName = platformCredential.envVarName;
	};

	const assertCredits = () => {
		if (getAvailableCredits(organization) <= 0) {
			throw new RealtimeConnectError(
				402,
				"insufficient_credits",
				`Organization ${organization.id} has insufficient credits`,
			);
		}
	};

	if (project.mode === "api-keys") {
		providerKey = await findProviderKey(
			project.organizationId,
			providerId,
			match.modelId,
		);
		if (!providerKey) {
			throw new RealtimeConnectError(
				400,
				"no_provider_key",
				`No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
			);
		}
		upstreamToken = readProviderKey(providerKey);
	} else if (project.mode === "credits") {
		assertCredits();
		await resolveCredits();
	} else if (project.mode === "hybrid") {
		providerKey = await findProviderKey(
			project.organizationId,
			providerId,
			match.modelId,
		);
		if (providerKey) {
			upstreamToken = readProviderKey(providerKey);
		} else {
			assertCredits();
			await resolveCredits();
		}
	} else {
		throw new RealtimeConnectError(
			400,
			"invalid_project_mode",
			`Invalid project mode: ${project.mode}`,
		);
	}

	// Only the official provider endpoint is supported for realtime v1: a BYOK
	// custom base URL (proxy) would silently bypass the metering-critical event
	// contract this service depends on.
	if (providerKey?.baseUrl) {
		throw new RealtimeConnectError(
			400,
			"custom_base_url_unsupported",
			"Realtime sessions do not support provider keys with a custom base URL. Remove the base URL override or use credits mode.",
		);
	}

	if (!upstreamToken) {
		throw new RealtimeConnectError(500, "no_token", "No token");
	}

	return {
		apiKey,
		project,
		organization,
		match,
		providerKey,
		managedKey,
		trackedKeyHealthId: providerKey?.id ?? managedKey?.id,
		upstreamToken,
		usedApiKeyHash: getApiKeyFingerprint(upstreamToken),
		envVarName,
		configIndex,
		envVariant,
		// Only an organization-owned BYOK key means the org pays the provider
		// directly. A platform-managed credential still bills as credits.
		usedMode: providerKey ? "api-keys" : "credits",
		allowedTranscriptionModelIds,
		clientIp: input.clientIp,
		safetyIdentifier: deriveSafetyIdentifier(organization.id, project.id),
	};
}
