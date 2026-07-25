import { findManagedProviderKey } from "@/lib/cached-queries.js";

import {
	providerKeyBaseUrlSupportsServiceTier,
	readProviderKey,
} from "@llmgateway/actions";
import { getProviderEnvValue } from "@llmgateway/models";

import {
	getProviderEnv,
	getServiceTierIneligibleEnvIndices,
} from "./get-provider-env.js";

import type { InferSelectModel, tables } from "@llmgateway/db";
import type { EnvVarVariant, Provider } from "@llmgateway/models";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

/**
 * The credential LLM Gateway itself pays for, used to serve credits-mode
 * requests. Either a managed provider-key row (the database-backed
 * configuration) or a value read from the provider's `LLM_*` env vars.
 *
 * Exactly one of `managedKey` / `envVarName` is set, and it determines where
 * request-health failures are attributed.
 */
export interface PlatformCredential {
	managedKey: ProviderKeyRow | undefined;
	token: string;
	configIndex: number;
	envVarName: string | undefined;
}

/**
 * Base URL a managed credential routes through, which lives in its `config`
 * (the env-var replacement) rather than the `baseUrl` column BYOK keys use.
 */
function managedBaseUrl(key: ProviderKeyRow): string | undefined {
	return key.config?.baseUrl ?? key.baseUrl ?? undefined;
}

/**
 * Flex/Priority is only honored when the request reaches the provider's real
 * upstream endpoint, so managed credentials pointed at a proxy — and, for
 * Google Vertex, credentials pinned to a non-global region — are skipped for
 * premium service-tier requests. Mirrors the env-credential filtering in
 * getServiceTierIneligibleEnvIndices.
 */
function supportsServiceTier(key: ProviderKeyRow): boolean {
	if (
		!providerKeyBaseUrlSupportsServiceTier(
			key.provider as Provider,
			managedBaseUrl(key) ?? null,
		)
	) {
		return false;
	}
	if (key.provider === "google-vertex") {
		return (key.config?.region ?? key.region ?? "global") === "global";
	}
	return true;
}

function combineFilters(
	...filters: (((key: ProviderKeyRow) => boolean) | undefined)[]
): ((key: ProviderKeyRow) => boolean) | undefined {
	const active = filters.filter((filter) => filter !== undefined);
	if (active.length === 0) {
		return undefined;
	}
	return (key) => active.every((filter) => filter(key));
}

export interface ResolvePlatformCredentialOptions {
	selectionScope: string;
	variant: EnvVarVariant | undefined;
	region: string | undefined;
	/** True when the request asked for a premium (flex/priority) service tier. */
	requiresServiceTier: boolean;
	excludedEnvIndices?: ReadonlySet<number>;
	excludedProviderKeyIds?: ReadonlySet<string>;
	/**
	 * Extra constraint on which managed credentials may serve the request, for
	 * callers whose endpoint needs more than the credential merely existing
	 * (e.g. video generation, which needs the credential's GCP project to match
	 * the output bucket's).
	 */
	filter?: (key: ProviderKeyRow) => boolean;
}

/**
 * Resolve the platform's own credential for a provider.
 *
 * Managed provider-key rows win when any are configured for the provider:
 * they are the database-backed replacement for the `LLM_*` environment
 * variables and carry their own base URL, project, region and other settings.
 * Deployments that have not migrated (or providers with no managed credential
 * yet) keep reading the environment exactly as before.
 */
export async function resolvePlatformCredential(
	provider: Provider,
	options: ResolvePlatformCredentialOptions,
): Promise<PlatformCredential> {
	const managedKey = await findManagedProviderKey(provider, {
		variant: options.variant,
		region: options.region,
		selectionScope: options.selectionScope,
		excludedKeyIds: options.excludedProviderKeyIds,
		filter: combineFilters(
			options.filter,
			options.requiresServiceTier ? supportsServiceTier : undefined,
		),
	});

	if (managedKey) {
		return {
			managedKey,
			token: readProviderKey(managedKey),
			configIndex: 0,
			envVarName: undefined,
		};
	}

	const excludedIndices = options.requiresServiceTier
		? new Set([
				...(options.excludedEnvIndices ?? []),
				...getServiceTierIneligibleEnvIndices(provider, options.variant),
			])
		: options.excludedEnvIndices;

	const envResult = getProviderEnv(provider, {
		selectionScope: options.selectionScope,
		excludedIndices,
		variant: options.variant,
	});

	return {
		managedKey: undefined,
		token: envResult.token,
		configIndex: envResult.configIndex,
		envVarName: envResult.envVarName,
	};
}

/**
 * One of a provider's credential settings (`baseUrl`, `project`, `region`, …)
 * for the credential actually serving the request.
 *
 * A managed credential carries its own settings and never falls back to the
 * environment, mirroring how a BYOK key is self-contained. Requests still on
 * the env-var path read the provider's `LLM_*` var as before.
 *
 * Endpoints that call `getProviderEndpoint` don't need this — passing
 * `managedCredentialOptions(managedKey)` covers them. It exists for the
 * endpoints (embeddings, speech, OCR, transcriptions, video) that build their
 * upstream URL themselves.
 */
export function getCredentialSetting(
	provider: Provider,
	key: string,
	managedKey: ProviderKeyRow | undefined,
	options: {
		configIndex?: number;
		defaultValue?: string;
		variant?: EnvVarVariant;
	} = {},
): string | undefined {
	if (managedKey) {
		return managedKey.config?.[key] ?? options.defaultValue;
	}
	return getProviderEnvValue(
		provider,
		key,
		options.configIndex,
		options.defaultValue,
		options.variant,
	);
}
