import { createHash } from "node:crypto";

import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	findPinnableProviderKey,
	hasManagedProviderCredential,
} from "@/lib/cached-queries.js";
import { parseCommaSeparatedEnv } from "@/lib/round-robin-env.js";

import { readProviderKey } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import {
	PROVIDER_KEY_DELETION_GRACE_SECONDS,
	providerKeyAllowsModel,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { PlatformCredential } from "./resolve-platform-credential.js";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ReasoningDetail } from "@llmgateway/models";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

/**
 * OpenAI and Azure encrypt replayable reasoning with a key bound to the
 * account (OpenAI organization, Azure resource) that produced it, so a later
 * turn sent with another credential of the same provider fails with
 * "encrypted content ... could not be verified". Each encrypted reasoning item
 * is therefore mapped to the credential that produced it, and the turn that
 * replays it is served by that same credential.
 *
 * Pins last as long as a deleted key stays pending, and every response
 * refreshes them, so an active conversation keeps its credential.
 */
export const REASONING_CREDENTIAL_PIN_TTL_SECONDS =
	PROVIDER_KEY_DELETION_GRACE_SECONDS;

const OPENAI_REASONING_FORMAT = "openai-responses-v1";

export interface ReasoningCredential {
	provider: string;
	source: "byok" | "managed" | "env";
	providerKeyId?: string;
	envVarName?: string;
	apiKeyHash: string;
}

export type PinnedCredential =
	| { kind: "byok"; providerKey: ProviderKeyRow }
	| { kind: "platform"; credential: PlatformCredential };

type ReplayableDetail = ReasoningDetail & { data: string };

function isAccountBoundReasoning(
	detail: ReasoningDetail | null | undefined,
): detail is ReplayableDetail {
	return (
		detail?.type === "reasoning.encrypted" &&
		detail.format === OPENAI_REASONING_FORMAT &&
		typeof detail.data === "string" &&
		detail.data.length > 0
	);
}

function pinKey(organizationId: string, data: string): string {
	const digest = createHash("sha256").update(data).digest("hex").slice(0, 32);
	return `reasoning_credential:${organizationId}:${digest}`;
}

/** The most recent account-bound reasoning payload a request replays. */
export function latestReplayedReasoningData(
	messages: readonly { role: string; reasoning_details?: unknown }[],
): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (
			message.role !== "assistant" ||
			!Array.isArray(message.reasoning_details)
		) {
			continue;
		}
		const details = message.reasoning_details as ReasoningDetail[];
		const latest = details.filter(isAccountBoundReasoning).at(-1);
		if (latest) {
			return latest.data;
		}
	}
	return undefined;
}

/**
 * Record which credential produced the account-bound reasoning in a response.
 * A failed write only costs the pin, so it is logged instead of failing the
 * response.
 */
export async function rememberReasoningCredential(
	organizationId: string,
	details: readonly ReasoningDetail[] | null | undefined,
	credential: ReasoningCredential | undefined,
): Promise<void> {
	if (!credential || !details) {
		return;
	}
	const replayable = details.filter(isAccountBoundReasoning);
	if (replayable.length === 0) {
		return;
	}
	const value = JSON.stringify(credential);
	const pipeline = redisClient.pipeline();
	for (const detail of replayable) {
		pipeline.set(
			pinKey(organizationId, detail.data),
			value,
			"EX",
			REASONING_CREDENTIAL_PIN_TTL_SECONDS,
		);
	}
	try {
		await pipeline.exec();
	} catch (error) {
		logger.warn("Failed to record reasoning credential pin", {
			organizationId,
			provider: credential.provider,
			error,
		});
	}
}

async function readPin(
	organizationId: string,
	data: string,
): Promise<ReasoningCredential | undefined> {
	try {
		const raw = await redisClient.get(pinKey(organizationId, data));
		return raw ? (JSON.parse(raw) as ReasoningCredential) : undefined;
	} catch (error) {
		logger.warn("Failed to read reasoning credential pin", {
			organizationId,
			error,
		});
		return undefined;
	}
}

function resolveEnvCredential(
	pin: ReasoningCredential,
): PlatformCredential | undefined {
	if (!pin.envVarName) {
		return undefined;
	}
	const value = process.env[pin.envVarName];
	if (!value) {
		return undefined;
	}
	const values = parseCommaSeparatedEnv(value);
	const configIndex = values.findIndex(
		(token) => getApiKeyFingerprint(token) === pin.apiKeyHash,
	);
	if (configIndex === -1) {
		return undefined;
	}
	return {
		managedKey: undefined,
		token: values[configIndex],
		configIndex,
		envVarName: pin.envVarName,
	};
}

/**
 * The credential that produced the reasoning this request replays, when the
 * project may still use it. Undefined means "select a credential normally".
 * A key deleted within its grace period ("pending_deletion") still resolves:
 * this is the only path that serves traffic with one.
 */
export async function resolveReasoningCredentialPin(params: {
	organizationId: string;
	projectMode: string;
	provider: string;
	model: string;
	messages: readonly { role: string; reasoning_details?: unknown }[];
}): Promise<PinnedCredential | undefined> {
	const data = latestReplayedReasoningData(params.messages);
	if (!data) {
		return undefined;
	}
	const pin = await readPin(params.organizationId, data);
	if (!pin || pin.provider !== params.provider) {
		return undefined;
	}

	const allowsByok =
		params.projectMode === "api-keys" || params.projectMode === "hybrid";
	const allowsPlatform =
		params.projectMode === "credits" || params.projectMode === "hybrid";

	if (pin.source === "env") {
		// Managed credentials supersede the provider's env vars entirely.
		if (!allowsPlatform || (await hasManagedProviderCredential(pin.provider))) {
			return undefined;
		}
		const credential = resolveEnvCredential(pin);
		return credential ? { kind: "platform", credential } : undefined;
	}

	if (!pin.providerKeyId) {
		return undefined;
	}
	const row = await findPinnableProviderKey(pin.providerKeyId);
	if (
		!row ||
		row.provider !== params.provider ||
		!providerKeyAllowsModel(row.allowedModels, params.model)
	) {
		return undefined;
	}
	if (pin.source === "managed") {
		if (!row.managed || !allowsPlatform) {
			return undefined;
		}
		return {
			kind: "platform",
			credential: {
				managedKey: row,
				token: readProviderKey(row),
				configIndex: 0,
				envVarName: undefined,
			},
		};
	}
	if (
		row.managed ||
		row.organizationId !== params.organizationId ||
		!allowsByok
	) {
		return undefined;
	}
	return { kind: "byok", providerKey: row };
}
