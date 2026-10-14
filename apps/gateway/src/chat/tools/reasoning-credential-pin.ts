import { createHash } from "node:crypto";

import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	findPinnableProviderKey,
	hasManagedProviderCredential,
} from "@/lib/cached-queries.js";
import { parseCommaSeparatedEnv } from "@/lib/round-robin-env.js";

import { isGoogleReasoningDetail, readProviderKey } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import {
	PROVIDER_KEY_DELETION_GRACE_SECONDS,
	providerKeyAllowsModel,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { usesEncryptedReasoning } from "@llmgateway/models";

import type { PlatformCredential } from "./resolve-platform-credential.js";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ReasoningDetail } from "@llmgateway/models";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

/**
 * Providers flagged `encryptedReasoning` in the catalogue return reasoning
 * payloads (encrypted reasoning items, thought signatures) that only verify
 * where they were issued. For OpenAI and Azure that is the account (OpenAI
 * organization, Azure resource), so a later turn sent with another credential
 * of the same provider fails with "encrypted content ... could not be
 * verified". Each payload is therefore mapped to the credential that produced
 * it, and the turn that replays it is served by that same credential.
 *
 * Pins last as long as a deleted key stays pending, and every response
 * refreshes them, so an active conversation keeps its credential.
 */
export const REASONING_CREDENTIAL_PIN_TTL_SECONDS =
	PROVIDER_KEY_DELETION_GRACE_SECONDS;

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

/** An assistant message or streamed delta that may carry bound reasoning. */
export interface ReasoningCarrier {
	reasoning_details?: unknown;
	tool_calls?: unknown;
	content?: unknown;
}

interface GoogleExtraContent {
	extra_content?: { google?: { thought_signature?: unknown } };
}

function googleSignature(value: unknown): string | undefined {
	const signature = (value as GoogleExtraContent | null | undefined)
		?.extra_content?.google?.thought_signature;
	return typeof signature === "string" && signature.length > 0
		? signature
		: undefined;
}

/**
 * Identifiers of the provider-bound reasoning a message carries, mirroring
 * `hasProviderBoundReasoning`: encrypted reasoning data, Gemini signed parts,
 * and tool-call thought signatures. A signed tool call also contributes its
 * id, because the gateway restores a signature cached by tool-call id when the
 * client did not send it back.
 */
export function providerBoundReasoningIds(carrier: ReasoningCarrier): string[] {
	const ids: string[] = [];
	if (Array.isArray(carrier.reasoning_details)) {
		for (const detail of carrier.reasoning_details as ReasoningDetail[]) {
			if (
				detail?.type === "reasoning.encrypted" &&
				typeof detail.data === "string" &&
				detail.data.length > 0
			) {
				ids.push(`data:${detail.data}`);
			} else if (detail && isGoogleReasoningDetail(detail)) {
				ids.push(`sig:${detail.signature as string}`);
			}
		}
	}
	if (Array.isArray(carrier.tool_calls)) {
		for (const call of carrier.tool_calls as ({
			id?: unknown;
		} & GoogleExtraContent)[]) {
			const signature = googleSignature(call);
			if (signature) {
				ids.push(`sig:${signature}`);
				if (typeof call.id === "string" && call.id.length > 0) {
					ids.push(`call:${call.id}`);
				}
			}
		}
	}
	if (Array.isArray(carrier.content)) {
		for (const part of carrier.content) {
			const signature = googleSignature(part);
			if (signature) {
				ids.push(`sig:${signature}`);
			}
		}
	}
	return ids;
}

/**
 * Identifiers to look a replaying request's pin up by: the provider-bound
 * reasoning of the latest assistant message carrying any, plus the ids of
 * every assistant tool call in that message (their signatures may only be in
 * the gateway's cache).
 */
function replayedReasoningIds(
	messages: readonly ({ role: string } & ReasoningCarrier)[],
): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") {
			continue;
		}
		const ids = providerBoundReasoningIds(message);
		if (Array.isArray(message.tool_calls)) {
			for (const call of message.tool_calls as { id?: unknown }[]) {
				if (typeof call?.id === "string" && call.id.length > 0) {
					ids.push(`call:${call.id}`);
				}
			}
		}
		if (ids.length > 0) {
			// Payload-derived ids first, latest first; tool-call ids only as a
			// fallback for signatures the client did not send back.
			const unique = [...new Set(ids)];
			return [
				...unique.filter((id) => !id.startsWith("call:")).reverse(),
				...unique.filter((id) => id.startsWith("call:")),
			];
		}
	}
	return [];
}

function pinKey(organizationId: string, id: string): string {
	const digest = createHash("sha256").update(id).digest("hex").slice(0, 32);
	return `reasoning_credential:${organizationId}:${digest}`;
}

/**
 * Record which credential produced the provider-bound reasoning in a response
 * (or streamed delta). Callers only pass carriers from providers flagged
 * `encryptedReasoning`. A failed write only costs the pin, so it is logged
 * instead of failing the response.
 */
export async function rememberReasoningCredential(
	organizationId: string,
	carrier: ReasoningCarrier | null | undefined,
	credential: ReasoningCredential | undefined,
): Promise<void> {
	if (!credential || !carrier) {
		return;
	}
	const ids = providerBoundReasoningIds(carrier);
	if (ids.length === 0) {
		return;
	}
	const value = JSON.stringify(credential);
	const pipeline = redisClient.pipeline();
	for (const id of new Set(ids)) {
		pipeline.set(
			pinKey(organizationId, id),
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
	ids: string[],
): Promise<ReasoningCredential | undefined> {
	try {
		const raws = await redisClient.mget(
			ids.map((id) => pinKey(organizationId, id)),
		);
		const raw = raws.find((value) => value !== null);
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
 * Whether a recorded pin binds this model: only mappings that return
 * provider-bound reasoning (`usesEncryptedReasoning`) are pinned, so a model
 * without reasoning on that provider — image models, for example — routes and
 * selects keys normally even when the conversation replays reasoning.
 */
export function reasoningPinBindsModel(
	pin: ReasoningCredential | undefined,
	mappings: readonly { providerId: string; reasoning?: boolean }[] | undefined,
): pin is ReasoningCredential {
	return (
		pin !== undefined &&
		(mappings ?? []).some(
			(mapping) =>
				mapping.providerId === pin.provider && usesEncryptedReasoning(mapping),
		)
	);
}

/**
 * The credential recorded for the provider-bound reasoning a request replays,
 * if any. Routing uses its provider; credential selection its key.
 */
export async function lookupReasoningPin(
	organizationId: string,
	messages: readonly ({ role: string } & ReasoningCarrier)[],
): Promise<ReasoningCredential | undefined> {
	const ids = replayedReasoningIds(messages);
	return ids.length === 0 ? undefined : await readPin(organizationId, ids);
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
	pin: ReasoningCredential | undefined;
}): Promise<PinnedCredential | undefined> {
	const { pin } = params;
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
