import { createHash } from "node:crypto";

import { HTTPException } from "hono/http-exception";

import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
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
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";

import { findRealtimeMapping, type RealtimeMappingMatch } from "./catalog.js";
import { RealtimeConnectError } from "./errors.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

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
	upstreamToken: string;
	usedApiKeyHash: string;
	envVarName: string | undefined;
	configIndex: number;
	usedMode: "api-keys" | "credits";
	/**
	 * Stable, privacy-preserving end-user identifier forwarded upstream via the
	 * OpenAI-Safety-Identifier header (a hash, never a raw internal id).
	 */
	safetyIdentifier: string;
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
	if (organization.status === "deleted") {
		throw new RealtimeConnectError(
			410,
			"organization_disabled",
			"Organization has been disabled and is no longer accessible",
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

	const iamValidation = await validateRequestModelAccess(
		apiKey,
		match.modelId,
		providerId,
		match.modelDef,
		input.clientIp,
	);
	if (!iamValidation.allowed) {
		try {
			throwIamException(iamValidation.reason ?? "Model access denied");
		} catch (error) {
			throw toConnectError(error);
		}
	}

	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: match.modelId,
		apiKeyId: apiKey.id,
		model: input.requestedModel,
	});

	// --- Upstream credential resolution (mirrors the embeddings path) ---
	let providerKey: ProviderKey | undefined;
	let upstreamToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;

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
		upstreamToken = providerKey.token;
	} else if (project.mode === "credits") {
		assertCredits();
		const envResult = getProviderEnv(providerId, {
			selectionScope: match.modelId,
		});
		upstreamToken = envResult.token;
		configIndex = envResult.configIndex;
		envVarName = envResult.envVarName;
	} else if (project.mode === "hybrid") {
		providerKey = await findProviderKey(
			project.organizationId,
			providerId,
			match.modelId,
		);
		if (providerKey) {
			upstreamToken = providerKey.token;
		} else {
			assertCredits();
			const envResult = getProviderEnv(providerId, {
				selectionScope: match.modelId,
			});
			upstreamToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
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
		upstreamToken,
		usedApiKeyHash: getApiKeyFingerprint(upstreamToken),
		envVarName,
		configIndex,
		usedMode: providerKey ? "api-keys" : "credits",
		safetyIdentifier: createHash("sha256")
			.update(`${organization.id}:${apiKey.id}`)
			.digest("hex")
			.slice(0, 32),
	};
}
