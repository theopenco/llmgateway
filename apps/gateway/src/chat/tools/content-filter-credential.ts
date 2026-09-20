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
	providerToken: string;
	/** Fully resolved endpoint the moderation call posts to. */
	url: string;
}

/**
 * The credential a gateway-internal moderation call runs on. A managed
 * credential supersedes the env vars for its provider entirely, so once one
 * exists the environment is never read — and a provider whose managed
 * credentials cannot serve the call has no env key left to fall back to. The
 * base URL follows the same credential, so a proxied deployment moderates
 * through its proxy.
 *
 * Always the base credential, never the enterprise-plan env override: this is
 * our own safety filter, not the organization's inference.
 */
export async function resolveContentFilterCredential(
	provider: ProviderId,
	path: string,
	selectionScope: string,
): Promise<ContentFilterCredential> {
	const defaultBaseUrl = getProviderDefaultBaseUrl(provider) ?? "";
	const buildUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;
	if (await hasManagedProviderCredential(provider)) {
		const managedKey = await findManagedProviderKey(provider, {
			selectionScope,
		});
		if (!managedKey) {
			throw new Error(
				`No managed credential available for provider: ${provider} (content filter)`,
			);
		}
		return {
			providerToken: readProviderKey(managedKey),
			url: buildUrl(managedKey.config?.baseUrl ?? defaultBaseUrl),
		};
	}
	const env = getProviderEnv(provider, { advanceRoundRobin: false });
	const baseUrl =
		getProviderEnvValue(provider, "baseUrl", env.configIndex) ?? defaultBaseUrl;
	return { providerToken: env.token, url: buildUrl(baseUrl) };
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
