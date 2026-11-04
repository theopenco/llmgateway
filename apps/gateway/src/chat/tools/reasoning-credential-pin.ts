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

const OPENAI_REASONING_FORMAT = "openai-responses-v1";

function isAccountBoundReasoningDetail(detail: ReasoningDetail): boolean {
	return (
		detail?.type === "reasoning.encrypted" &&
		detail.format === OPENAI_REASONING_FORMAT
	);
}

/**
 * The messages without OpenAI-format encrypted reasoning, which only verifies
 * on the account that produced it. It is optional context — the upstream
 * accepts a replay without it and the model reasons afresh — so a turn
 * that must move to another credential, or whose reasoning an account rejects,
 * can still be served without it. Gemini signatures are kept: a signed function
 * call is required, not optional.
 */
export function stripAccountBoundReasoning<T extends StrippableMessage>(
	messages: readonly T[],
): { messages: T[]; stripped: boolean } {
	return stripReasoningDetails(messages, isAccountBoundReasoningDetail);
}

interface StrippableMessage {
	role: string;
	reasoning_details?: unknown;
	content?: unknown;
	tool_calls?: unknown;
}

/**
 * The messages without the reasoning details `drop` matches. An assistant
 * message that carried only such reasoning (an incomplete prior turn: no
 * content, no tool calls) is removed with it — a chat-completions upstream
 * rejects an assistant message with neither.
 */
function stripReasoningDetails<T extends StrippableMessage>(
	messages: readonly T[],
	drop: (detail: ReasoningDetail) => boolean,
): { messages: T[]; stripped: boolean } {
	let stripped = false;
	const result = messages.flatMap((message) => {
		if (
			message.role !== "assistant" ||
			!Array.isArray(message.reasoning_details)
		) {
			return [message];
		}
		const details = message.reasoning_details as ReasoningDetail[];
		const kept = details.filter((detail) => !drop(detail));
		if (kept.length === details.length) {
			return [message];
		}
		stripped = true;
		if (kept.length > 0) {
			return [{ ...message, reasoning_details: kept }];
		}
		const { reasoning_details: _dropped, ...rest } = message;
		const hasContent =
			typeof rest.content === "string"
				? rest.content.length > 0
				: Array.isArray(rest.content)
					? rest.content.length > 0
					: rest.content !== null && rest.content !== undefined;
		const hasToolCalls =
			Array.isArray(rest.tool_calls) && rest.tool_calls.length > 0;
		return hasContent || hasToolCalls ? [rest as T] : [];
	});
	return { messages: result, stripped };
}

/** An upstream rejection of encrypted reasoning from another account. */
export function isInvalidEncryptedContentError(
	errorText: string | undefined,
): boolean {
	return errorText?.includes("invalid_encrypted_content") ?? false;
}

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
 * Identifiers to look a replaying request's pin up by, in lookup order:
 * provider-bound reasoning payloads newest first, then assistant tool-call ids
 * newest first (their signatures may only be in the gateway's cache). Every
 * assistant message is searched, since the newest one may carry only unsigned
 * tool calls while an earlier one holds the replayed reasoning. Capped so a
 * long conversation costs one bounded MGET.
 */
const MAX_PIN_LOOKUP_IDS = 64;

function replayedReasoningIds(
	messages: readonly ({ role: string } & ReasoningCarrier)[],
): string[] {
	const payloadIds: string[] = [];
	const callIds: string[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") {
			continue;
		}
		const ids = providerBoundReasoningIds(message);
		payloadIds.push(...ids.filter((id) => !id.startsWith("call:")).reverse());
		if (Array.isArray(message.tool_calls)) {
			for (const call of message.tool_calls as { id?: unknown }[]) {
				if (typeof call?.id === "string" && call.id.length > 0) {
					callIds.push(`call:${call.id}`);
				}
			}
		}
	}
	return [
		...new Set([
			...payloadIds.slice(0, MAX_PIN_LOOKUP_IDS),
			...callIds.slice(0, MAX_PIN_LOOKUP_IDS),
		]),
	];
}

export function pinKey(organizationId: string, id: string): string {
	const digest = createHash("sha256").update(id).digest("hex").slice(0, 32);
	return `reasoning_credential:${organizationId}:${digest}`;
}

/**
 * A payload an account already refused (`invalid_encrypted_content`). It is
 * left out of every later turn instead of costing a rejected attempt each.
 */
interface RejectedReasoning {
	rejected: true;
}

type StoredPin = ReasoningCredential | RejectedReasoning;

function isRejectedPin(pin: StoredPin): pin is RejectedReasoning {
	return "rejected" in pin && pin.rejected === true;
}

function parsePin(raw: string): StoredPin | undefined {
	try {
		return JSON.parse(raw) as StoredPin;
	} catch {
		return undefined;
	}
}

async function readPins(
	organizationId: string,
	ids: readonly string[],
): Promise<Map<string, StoredPin>> {
	const pins = new Map<string, StoredPin>();
	if (ids.length === 0) {
		return pins;
	}
	const raws = await redisClient.mget(
		ids.map((id) => pinKey(organizationId, id)),
	);
	raws.forEach((raw, index) => {
		const pin = raw ? parsePin(raw) : undefined;
		if (pin) {
			pins.set(ids[index], pin);
		}
	});
	return pins;
}

/**
 * Whether a pin names `credential`. Keys stored in the database are matched
 * by row, so a rotated token on the same key (the same account) keeps its
 * reasoning; env credentials have no row and are matched by token fingerprint.
 */
function sameCredential(
	pin: ReasoningCredential,
	credential: ReasoningCredential,
): boolean {
	if (pin.provider !== credential.provider) {
		return false;
	}
	return pin.providerKeyId && credential.providerKeyId
		? pin.providerKeyId === credential.providerKeyId
		: pin.apiKeyHash === credential.apiKeyHash;
}

/**
 * Ids of the OpenAI-format encrypted payloads a request replays, newest first
 * and capped like `replayedReasoningIds`, so a long conversation costs one
 * bounded MGET per turn. Older payloads past the cap are sent as they are.
 */
function accountBoundIds<
	T extends { role: string; reasoning_details?: unknown },
>(messages: readonly T[]): string[] {
	const ids = new Set<string>();
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (
			message.role !== "assistant" ||
			!Array.isArray(message.reasoning_details)
		) {
			continue;
		}
		const details = message.reasoning_details as ReasoningDetail[];
		for (let j = details.length - 1; j >= 0; j--) {
			if (isAccountBoundReasoningDetail(details[j])) {
				ids.add(`data:${details[j].data as string}`);
			}
		}
		if (ids.size >= MAX_PIN_LOOKUP_IDS) {
			break;
		}
	}
	return [...ids].slice(0, MAX_PIN_LOOKUP_IDS);
}

/**
 * The messages without the OpenAI-format encrypted reasoning that `credential`
 * cannot verify: payloads recorded for another credential, and payloads an
 * account already rejected. A conversation that failed over, retried on
 * another key, or moved between OpenAI and Azure carries reasoning from more
 * than one account; the pin only names one of them, and the upstream rejects
 * the whole request over a single foreign item. Payloads without a pin are
 * kept. Pins of the payloads that are sent are refreshed, so a conversation
 * that outlives the pin TTL keeps its credential.
 */
export async function stripForeignReasoning<T extends StrippableMessage>(
	organizationId: string,
	messages: readonly T[],
	credential: ReasoningCredential | undefined,
): Promise<{ messages: T[]; stripped: boolean }> {
	const ids = accountBoundIds(messages);
	if (ids.length === 0 || !credential) {
		return { messages: [...messages], stripped: false };
	}
	let pins: Map<string, StoredPin>;
	try {
		pins = await readPins(organizationId, ids);
	} catch (error) {
		logger.warn("Failed to read reasoning credential pins", {
			organizationId,
			error,
		});
		return { messages: [...messages], stripped: false };
	}
	const foreign = (detail: ReasoningDetail): boolean => {
		if (!isAccountBoundReasoningDetail(detail)) {
			return false;
		}
		const pin = pins.get(`data:${detail.data as string}`);
		if (!pin) {
			return false;
		}
		return isRejectedPin(pin) || !sameCredential(pin, credential);
	};
	const { messages: result, stripped } = stripReasoningDetails(
		messages,
		foreign,
	);
	// Refresh the pins of what is sent, and the tombstones of what is left
	// out: a client replays its full history, so a rejected payload would
	// otherwise resurface once its tombstone expires.
	const refresh = ids.filter((id) => {
		const pin = pins.get(id);
		return (
			pin !== undefined &&
			(isRejectedPin(pin) || sameCredential(pin, credential))
		);
	});
	if (refresh.length > 0) {
		const pipeline = redisClient.pipeline();
		for (const id of refresh) {
			pipeline.expire(
				pinKey(organizationId, id),
				REASONING_CREDENTIAL_PIN_TTL_SECONDS,
			);
		}
		try {
			await pipeline.exec();
		} catch (error) {
			logger.warn("Failed to refresh reasoning credential pins", {
				organizationId,
				error,
			});
		}
	}
	return { messages: result, stripped };
}

/**
 * Record the encrypted reasoning an account refused, so later turns leave it
 * out up front. The upstream names one item; that one and every payload the
 * request carried without a pin (unknown origin) are marked. Payloads pinned
 * to `credential` and not named are kept: they were not the cause. When that
 * leaves nothing (every payload is pinned here and the client dropped the
 * item ids), every payload is marked: that is what the self-heal retry sends
 * anyway, and it keeps the next turn from being rejected again.
 */
export async function rememberRejectedReasoning<
	T extends { role: string; reasoning_details?: unknown },
>(
	organizationId: string,
	messages: readonly T[],
	credential: ReasoningCredential | undefined,
	errorText: string | undefined,
): Promise<void> {
	const ids = accountBoundIds(messages);
	if (ids.length === 0 || !credential) {
		return;
	}
	const namedItem = errorText?.match(/\brs_[0-9a-f]+/)?.[0];
	const namedIds = new Set<string>();
	if (namedItem) {
		for (const message of messages) {
			if (
				message.role !== "assistant" ||
				!Array.isArray(message.reasoning_details)
			) {
				continue;
			}
			for (const detail of message.reasoning_details as ReasoningDetail[]) {
				if (isAccountBoundReasoningDetail(detail) && detail.id === namedItem) {
					namedIds.add(`data:${detail.data as string}`);
				}
			}
		}
	}
	try {
		const pins = await readPins(organizationId, ids);
		let rejected = ids.filter((id) => {
			const pin = pins.get(id);
			return (
				namedIds.has(id) ||
				!pin ||
				isRejectedPin(pin) ||
				!sameCredential(pin, credential)
			);
		});
		if (rejected.length === 0) {
			logger.warn("Account rejected reasoning pinned to it; marking all", {
				organizationId,
				provider: credential.provider,
				payloads: ids.length,
			});
			rejected = ids;
		}
		await markDiscardedReasoning(organizationId, rejected);
	} catch (error) {
		logger.warn("Failed to record rejected reasoning", {
			organizationId,
			error,
		});
	}
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
		for (const raw of raws) {
			const pin = raw ? parsePin(raw) : undefined;
			if (pin && !isRejectedPin(pin)) {
				return pin;
			}
		}
		return undefined;
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
async function markDiscardedReasoning(
	organizationId: string,
	ids: readonly string[],
): Promise<void> {
	if (ids.length === 0) {
		return;
	}
	try {
		const value = JSON.stringify({
			rejected: true,
		} satisfies RejectedReasoning);
		const pipeline = redisClient.pipeline();
		for (const id of ids) {
			pipeline.set(
				pinKey(organizationId, id),
				value,
				"EX",
				REASONING_CREDENTIAL_PIN_TTL_SECONDS,
			);
		}
		await pipeline.exec();
	} catch (error) {
		logger.warn("Failed to record discarded reasoning", {
			organizationId,
			error,
		});
	}
}
/** Keep reasoning omitted by a successful fallback from reclaiming its old provider. */
export async function rememberDroppedReasoning<
	T extends { role: string; reasoning_details?: unknown },
>(organizationId: string, messages: readonly T[]): Promise<void> {
	await markDiscardedReasoning(organizationId, accountBoundIds(messages));
}
