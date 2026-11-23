import {
	findManagedProviderKey,
	hasManagedProviderCredential,
} from "@/lib/cached-queries.js";

import {
	getProviderDefaultBaseUrl,
	readProviderKey,
} from "@llmgateway/actions";
import {
	getProviderEnvValue,
	getProviderEnvVar,
	type ProviderId,
} from "@llmgateway/models";

import { getEnvKeyCount, getProviderEnv } from "./get-provider-env.js";

export interface ContentFilterCredential {
	/**
	 * Managed key id, or `env:<index>` for an env credential. Lets a retry
	 * move to another credential.
	 */
	id: string;
	providerToken: string;
	/** Fully resolved endpoint the moderation call posts to. */
	url: string;
}

/** Credentials that answered 429, by id, until the cooldown ends (epoch ms). */
const rateLimitedUntil = new Map<string, number>();
const RATE_LIMIT_COOLDOWN_DEFAULT_MS = 2_000;
const RATE_LIMIT_COOLDOWN_MAX_MS = 10_000;
let envRotation = 0;

/**
 * Keep a credential that answered 429 out of rotation for a few seconds, so
 * the next calls on this pod prefer another one.
 */
export function markContentFilterCredentialRateLimited(
	id: string,
	retryAfterMs?: number,
	now = Date.now(),
): void {
	const cooldownMs = Math.min(
		Math.max(retryAfterMs ?? 0, RATE_LIMIT_COOLDOWN_DEFAULT_MS),
		RATE_LIMIT_COOLDOWN_MAX_MS,
	);
	rateLimitedUntil.set(id, now + cooldownMs);
}

/** Test hook: forget every cooldown. */
export function resetContentFilterCredentialCooldowns(): void {
	rateLimitedUntil.clear();
	envRotation = 0;
}

function coolingDownIds(now = Date.now()): Set<string> {
	const ids = new Set<string>();
	for (const [id, until] of rateLimitedUntil) {
		if (until > now) {
			ids.add(id);
		} else {
			rateLimitedUntil.delete(id);
		}
	}
	return ids;
}

/**
 * The credential a gateway-internal moderation call runs on, rotated over
 * every eligible credential per call. A managed credential supersedes the env
 * vars for its provider entirely, so once one exists the environment is never
 * read — and a provider whose managed credentials cannot serve the call has no
 * env key left to fall back to. The base URL follows the same credential, so a
 * proxied deployment moderates through its proxy.
 *
 * `avoidIds` (credentials that already failed this call) and credentials on a
 * 429 cooldown are skipped while any other credential remains.
 *
 * Always the base credential, never the enterprise-plan env override: this is
 * our own safety filter, not the organization's inference.
 */
export async function resolveContentFilterCredential(
	provider: ProviderId,
	path: string,
	selectionScope: string,
	avoidIds: ReadonlySet<string> = new Set(),
): Promise<ContentFilterCredential> {
	const defaultBaseUrl = getProviderDefaultBaseUrl(provider) ?? "";
	const buildUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;
	const cooling = coolingDownIds();
	const preferences = [
		new Set([...avoidIds, ...cooling]),
		...(cooling.size > 0 ? [new Set(avoidIds)] : []),
		...(avoidIds.size > 0 ? [new Set<string>()] : []),
	];

	if (await hasManagedProviderCredential(provider)) {
		for (const excludedKeyIds of preferences) {
			const managedKey = await findManagedProviderKey(provider, {
				selectionScope,
				excludedKeyIds,
				rotateEveryCall: true,
			});
			if (managedKey) {
				return {
					id: managedKey.id,
					providerToken: readProviderKey(managedKey),
					url: buildUrl(managedKey.config?.baseUrl ?? defaultBaseUrl),
				};
			}
		}
		throw new Error(
			`No managed credential available for provider: ${provider} (content filter)`,
		);
	}

	const count = getEnvKeyCount(getProviderEnvVar(provider));
	const start = envRotation++;
	let configIndex: number | undefined;
	for (const excluded of preferences) {
		for (let offset = 0; offset < count; offset++) {
			const index = (start + offset) % count;
			if (!excluded.has(`env:${index}`)) {
				configIndex = index;
				break;
			}
		}
		if (configIndex !== undefined) {
			break;
		}
	}
	const env =
		configIndex === undefined
			? getProviderEnv(provider, { advanceRoundRobin: false })
			: getProviderEnv(provider, { configIndex });
	const baseUrl =
		getProviderEnvValue(provider, "baseUrl", env.configIndex) ?? defaultBaseUrl;
	return {
		id: `env:${env.configIndex}`,
		providerToken: env.token,
		url: buildUrl(baseUrl),
	};
}

/**
 * Whether a moderation call to this provider could be made at all. Lets
 * deployments without the credential skip the filter instead of failing open
 * per request.
 */
export async function hasContentFilterCredential(
	provider: ProviderId,
): Promise<boolean> {
	if (await hasManagedProviderCredential(provider)) {
		return true;
	}
	return getEnvKeyCount(getProviderEnvVar(provider)) > 0;
}
