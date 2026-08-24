import { createHash, randomBytes } from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { RealtimeConnectError } from "./errors.js";

export const CLIENT_SECRET_PREFIX = "ek_";
export const DEFAULT_CLIENT_SECRET_TTL_SECONDS = 60;
export const MIN_CLIENT_SECRET_TTL_SECONDS = 10;
export const MAX_CLIENT_SECRET_TTL_SECONDS = 300;

/**
 * Upper bound on pinned session instructions, in estimated tokens. 16,384 is
 * OpenAI's realtime instructions cap, applied to every realtime provider as a
 * single conservative guard. The estimate is chars/4 rather than a real
 * tokenizer, so the provider stays authoritative for the exact boundary.
 */
export const MAX_CLIENT_SECRET_INSTRUCTIONS_TOKENS = 16_384;

/**
 * Versioned record stored in Redis for one ephemeral client secret. The
 * bearer secret itself never appears in Redis keys or values — records are
 * addressed by the secret's SHA-256 fingerprint.
 */
export interface RealtimeClientSecretRecord {
	v: 1;
	/**
	 * Raw LLMGateway API token the secret stands in for; substituted back at
	 * WebSocket upgrade time.
	 */
	token: string;
	/**
	 * Canonical realtime model pinned at mint time.
	 */
	model: string;
	/**
	 * Transcription model pinned at mint time, or null when the secret does
	 * not authorize input transcription.
	 */
	transcriptionModel: string | null;
	/**
	 * Session instructions pinned at mint time, or null when the caller did not
	 * pin any. Applied by the gateway on connect and locked thereafter.
	 */
	instructions: string | null;
	/**
	 * Output voice pinned at mint time, or null for the provider default. Only a
	 * default, not a lock: the client may still change it via session.update.
	 */
	voice: string | null;
	/**
	 * Validated x-source header captured at mint time for billing attribution.
	 */
	source: string | null;
	createdAt: number;
	expiresAt: number;
}

export function generateClientSecretValue(): string {
	return `${CLIENT_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * Address for a secret's Redis record: a SHA-256 fingerprint, so the bearer
 * credential itself is absent from Redis keys, logs, and monitoring tools.
 */
export function clientSecretRedisKey(secret: string): string {
	const fingerprint = createHash("sha256").update(secret).digest("hex");
	return `realtime:client-secrets:${fingerprint}`;
}

/**
 * Clamp a requested TTL to the gateway's allowed range. Non-numeric or
 * missing input yields the default.
 */
export function clampClientSecretTtl(seconds: unknown): number {
	if (
		typeof seconds !== "number" ||
		!Number.isFinite(seconds) ||
		Number.isNaN(seconds)
	) {
		return DEFAULT_CLIENT_SECRET_TTL_SECONDS;
	}
	return Math.min(
		MAX_CLIENT_SECRET_TTL_SECONDS,
		Math.max(MIN_CLIENT_SECRET_TTL_SECONDS, Math.floor(seconds)),
	);
}

export interface CreateClientSecretInput {
	token: string;
	model: string;
	transcriptionModel: string | null;
	instructions: string | null;
	voice: string | null;
	source: string | null;
	ttlSeconds: number;
}

/**
 * Mint a new client secret and store its record under the fingerprinted key
 * with the exact TTL. Fails closed on any Redis error. Client secrets are
 * reusable until expiry (matching OpenAI semantics), so the record is only
 * read — never consumed — by the WebSocket upgrade path.
 */
export async function createClientSecret(
	input: CreateClientSecretInput,
): Promise<{ value: string; expiresAt: number }> {
	const value = generateClientSecretValue();
	const now = Date.now();
	const expiresAt = Math.floor(now / 1000) + input.ttlSeconds;
	const record: RealtimeClientSecretRecord = {
		v: 1,
		token: input.token,
		model: input.model,
		transcriptionModel: input.transcriptionModel,
		instructions: input.instructions,
		voice: input.voice,
		source: input.source,
		createdAt: Math.floor(now / 1000),
		expiresAt,
	};

	let result: unknown;
	try {
		result = await redisClient.set(
			clientSecretRedisKey(value),
			JSON.stringify(record),
			"EX",
			input.ttlSeconds,
			"NX",
		);
	} catch (error) {
		logger.error("Failed to store realtime client secret", error as Error);
		throw new RealtimeConnectError(
			503,
			"client_secret_unavailable",
			"Realtime client secrets are temporarily unavailable. Please retry.",
		);
	}
	if (result !== "OK") {
		// A fingerprint collision on 32 random bytes is effectively impossible;
		// treat it as an infrastructure fault rather than retrying silently.
		logger.error("Realtime client secret key collision", {});
		throw new RealtimeConnectError(
			503,
			"client_secret_unavailable",
			"Realtime client secrets are temporarily unavailable. Please retry.",
		);
	}

	return { value, expiresAt };
}

/**
 * Validate a parsed Redis payload instead of trusting arbitrary JSON. An
 * unknown version or malformed field invalidates the record.
 */
export function parseClientSecretRecord(
	raw: string,
): RealtimeClientSecretRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	if (record.v !== 1) {
		return null;
	}
	if (typeof record.token !== "string" || record.token.length === 0) {
		return null;
	}
	if (typeof record.model !== "string" || record.model.length === 0) {
		return null;
	}
	if (
		record.transcriptionModel !== null &&
		typeof record.transcriptionModel !== "string"
	) {
		return null;
	}
	// instructions/voice postdate the v1 record shape. Secrets minted by an
	// older build stay valid for their remaining TTL across a deploy, so an
	// absent key is "not pinned" rather than a malformed record.
	if (
		record.instructions !== undefined &&
		record.instructions !== null &&
		typeof record.instructions !== "string"
	) {
		return null;
	}
	if (
		record.voice !== undefined &&
		record.voice !== null &&
		typeof record.voice !== "string"
	) {
		return null;
	}
	if (record.source !== null && typeof record.source !== "string") {
		return null;
	}
	if (
		typeof record.createdAt !== "number" ||
		typeof record.expiresAt !== "number"
	) {
		return null;
	}
	return {
		v: 1,
		token: record.token,
		model: record.model,
		transcriptionModel: record.transcriptionModel,
		instructions: record.instructions ?? null,
		voice: record.voice ?? null,
		source: record.source,
		createdAt: record.createdAt,
		expiresAt: record.expiresAt,
	};
}

/**
 * Look up a presented client secret. Returns null for unknown, expired, or
 * malformed records; throws a fail-closed connect error when Redis is
 * unavailable.
 */
export async function getClientSecretRecord(
	secret: string,
): Promise<RealtimeClientSecretRecord | null> {
	let raw: string | null;
	try {
		raw = await redisClient.get(clientSecretRedisKey(secret));
	} catch (error) {
		logger.error("Failed to read realtime client secret", error as Error);
		throw new RealtimeConnectError(
			503,
			"client_secret_unavailable",
			"Realtime client secrets are temporarily unavailable. Please retry.",
		);
	}
	if (!raw) {
		return null;
	}
	const record = parseClientSecretRecord(raw);
	if (!record) {
		return null;
	}
	// Redis TTL is authoritative; this is a belt-and-suspenders check against
	// clock skew or a missing expiry.
	if (record.expiresAt * 1000 <= Date.now()) {
		return null;
	}
	return record;
}
