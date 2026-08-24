import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import {
	ENV_VAR_VARIANT_SUFFIXES,
	getProviderEnvVar,
	getRegionEnvVarSuffix,
	providers,
} from "@llmgateway/models";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { ProviderDefinition } from "@llmgateway/models";

export type EnvCredentialVariant = "default" | "enterprise" | "plans";

const ENV_CREDENTIAL_VARIANTS: readonly EnvCredentialVariant[] = [
	"default",
	"enterprise",
	"plans",
];

/**
 * One API key the deployment's environment currently holds for a provider,
 * described without its plaintext: the variable it came from, the audience and
 * region that variable serves, and the same mask/fingerprint pair a managed
 * credential is identified by. `tokenHash` matches `log.usedApiKeyHash` on the
 * requests the key served, so an operator can correlate the two.
 */
export interface EnvCredential {
	envVar: string;
	variant: EnvCredentialVariant;
	/** Region the variable is scoped to via `__{REGION}`, null for the base. */
	region: string | null;
	/** Position in the comma-separated list; matches the gateway's configIndex. */
	index: number;
	maskedToken: string;
	tokenHash: string;
}

/**
 * Snapshot of every `LLM_*` API key a process can see, published by the gateway
 * so the admin dashboard can list them.
 *
 * It exists because the gateway and the API are separate deployments: provider
 * keys are set on the gateway (the only service that spends them), so the API
 * reading its own `process.env` reports nothing — and where both happen to have
 * them, the API's copy can silently drift from the set actually serving
 * traffic. Publishing from the gateway makes the dashboard reflect the process
 * that pays the bills.
 *
 * Deliberately secret-free: masks and one-way HMAC fingerprints only, never a
 * token. It is still internal data — the only reader is the admin-gated catalog
 * route.
 */
export interface ProviderEnvInventory {
	version: 1;
	publishedAt: string;
	/** Only providers with at least one key present appear. */
	providers: Record<string, EnvCredential[]>;
}

/**
 * Namespaced per NODE_ENV so a locally running gateway's snapshot can never be
 * picked up by a test run sharing the same Redis.
 *
 * Under vitest it is narrowed further to the worker, because the point of this
 * key is that separate processes share it: test files run in parallel against
 * one Redis, and a suite publishing a snapshot would otherwise decide what an
 * unrelated suite reads. Nothing outside vitest sets VITEST_WORKER_ID.
 */
function inventoryKey(): string {
	const worker = process.env.VITEST_WORKER_ID;
	const scope = worker
		? `test-worker-${worker}`
		: (process.env.NODE_ENV ?? "development");
	return `provider-env-inventory:v1:${scope}`;
}

/**
 * Long enough that a brief gateway outage doesn't blank the dashboard, short
 * enough that a gateway which is gone for good stops being reported as the
 * source. Must stay comfortably above the refresh interval below.
 */
const INVENTORY_TTL_SECONDS = 900;

const REFRESH_INTERVAL_MS = 300_000;

/**
 * A service-account JSON value contains commas and is read whole by the
 * gateway rather than comma-split; masking must treat it the same way or the
 * "list" would be JSON fragments.
 */
function splitEnvApiKeys(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	if (trimmed.startsWith("{")) {
		return [trimmed];
	}
	return trimmed
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function providerRegionIds(providerId: string): string[] {
	const definition = providers.find((entry) => entry.id === providerId) as
		ProviderDefinition | undefined;
	return (definition?.regionConfig?.regions ?? []).map((region) => region.id);
}

/**
 * Enumerates the API keys the current process's environment holds for a
 * provider, across the base var, the `__ENTERPRISE`/`__PLANS` variants and
 * every `__{REGION}` override of each — the same slots the gateway reads.
 */
export function collectProviderEnvCredentials(
	providerId: string,
): EnvCredential[] {
	const baseEnvVar = getProviderEnvVar(providerId);
	if (!baseEnvVar) {
		return [];
	}

	const slots: {
		envVar: string;
		variant: EnvCredentialVariant;
		region: string | null;
	}[] = [];
	for (const variant of ENV_CREDENTIAL_VARIANTS) {
		const variantVar =
			variant === "default"
				? baseEnvVar
				: `${baseEnvVar}${ENV_VAR_VARIANT_SUFFIXES[variant]}`;
		slots.push({ envVar: variantVar, variant, region: null });
		for (const region of providerRegionIds(providerId)) {
			slots.push({
				envVar: `${variantVar}__${getRegionEnvVarSuffix(region)}`,
				variant,
				region,
			});
		}
	}

	const entries: EnvCredential[] = [];
	for (const slot of slots) {
		const value = process.env[slot.envVar];
		if (!value) {
			continue;
		}
		splitEnvApiKeys(value).forEach((key, index) => {
			entries.push({
				envVar: slot.envVar,
				variant: slot.variant,
				region: slot.region,
				index,
				maskedToken: maskToken(key),
				tokenHash: getApiKeyFingerprint(key),
			});
		});
	}
	return entries;
}

/**
 * How many API keys an audience has configured, counted the way
 * `getProviderEnvValue` resolves them: the base variable of that audience only,
 * so 0 for a variant means it is unset and matching organizations fall back to
 * the `default` list. Regional overrides are separate slots and not counted.
 */
export function countEnvCredentialsByVariant(
	entries: EnvCredential[],
): Record<EnvCredentialVariant, number> {
	const counts: Record<EnvCredentialVariant, number> = {
		default: 0,
		enterprise: 0,
		plans: 0,
	};
	for (const entry of entries) {
		if (entry.region === null) {
			counts[entry.variant] += 1;
		}
	}
	return counts;
}

export function buildProviderEnvInventory(): ProviderEnvInventory {
	const byProvider: Record<string, EnvCredential[]> = {};
	for (const provider of providers) {
		// "custom" is a per-organization BYOK construct with no platform-wide
		// deployment, matching the catalog route's exclusion.
		if (provider.id === "custom") {
			continue;
		}
		const entries = collectProviderEnvCredentials(provider.id);
		if (entries.length > 0) {
			byProvider[provider.id] = entries;
		}
	}

	return {
		version: 1,
		publishedAt: new Date().toISOString(),
		providers: byProvider,
	};
}

export async function publishProviderEnvInventory(): Promise<void> {
	await redisClient.set(
		inventoryKey(),
		JSON.stringify(buildProviderEnvInventory()),
		"EX",
		INVENTORY_TTL_SECONDS,
	);
}

/**
 * Drops the published snapshot, so readers fall back to their own environment
 * immediately instead of waiting out the TTL. Nothing in the request path calls
 * this — the gateway lets the key expire on shutdown — but tests need to assert
 * both the snapshot and the fallback path without one leaking into the other.
 */
export async function deleteProviderEnvInventory(): Promise<void> {
	await redisClient.del(inventoryKey());
}

/**
 * Publishes this process's env credentials and keeps the snapshot fresh.
 *
 * Advisory only — a deployment where publishing fails keeps serving traffic
 * exactly as before, the dashboard just falls back to reporting the API's own
 * environment. Returns a stop function for shutdown.
 */
export function startProviderEnvInventoryPublisher(): () => void {
	const publish = () => {
		void publishProviderEnvInventory().catch((error) => {
			logger.warn("Failed to publish provider env inventory", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	publish();
	const timer = setInterval(publish, REFRESH_INTERVAL_MS);
	// Never hold the process open for a purely informational refresh.
	timer.unref();

	return () => clearInterval(timer);
}

function isEnvCredential(value: unknown): value is EnvCredential {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.envVar === "string" &&
		typeof entry.maskedToken === "string" &&
		typeof entry.tokenHash === "string" &&
		typeof entry.index === "number" &&
		(entry.region === null || typeof entry.region === "string") &&
		ENV_CREDENTIAL_VARIANTS.includes(entry.variant as EnvCredentialVariant)
	);
}

/**
 * Reads the gateway's published snapshot, or null when none exists (no gateway
 * has published yet, it does not share this Redis, or the last one expired).
 * Callers fall back to their own environment in that case.
 *
 * Unreadable or malformed payloads are treated as absent rather than thrown:
 * this only feeds a dashboard listing, and failing the whole catalog request
 * over it would be worse than showing the fallback.
 */
export async function readProviderEnvInventory(): Promise<ProviderEnvInventory | null> {
	let raw: string | null;
	try {
		raw = await redisClient.get(inventoryKey());
	} catch (error) {
		logger.warn("Failed to read provider env inventory", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}

	if (!raw) {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		logger.warn("Discarding unparseable provider env inventory");
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}
	const snapshot = parsed as Record<string, unknown>;
	if (
		snapshot.version !== 1 ||
		typeof snapshot.publishedAt !== "string" ||
		typeof snapshot.providers !== "object" ||
		snapshot.providers === null
	) {
		return null;
	}

	const byProvider: Record<string, EnvCredential[]> = {};
	for (const [provider, entries] of Object.entries(
		snapshot.providers as Record<string, unknown>,
	)) {
		if (Array.isArray(entries) && entries.every(isEnvCredential)) {
			byProvider[provider] = entries;
			continue;
		}
		// Dropping these silently would look exactly like the provider having no
		// keys at all — the very misreading this snapshot exists to prevent.
		logger.warn("Discarding malformed provider env inventory entries", {
			provider,
		});
	}

	return {
		version: 1,
		publishedAt: snapshot.publishedAt,
		providers: byProvider,
	};
}
