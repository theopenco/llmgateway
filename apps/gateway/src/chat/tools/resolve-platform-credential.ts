import { HTTPException } from "hono/http-exception";

import {
	findManagedProviderKey,
	hasManagedProviderCredential,
} from "@/lib/cached-queries.js";

import { readProviderKey } from "@llmgateway/actions";
import { providerKeyAllowsModel } from "@llmgateway/db";
import { getProviderEnvValue, providers } from "@llmgateway/models";

import {
	getProviderEnv,
	getServiceTierIneligibleEnvIndices,
} from "./get-provider-env.js";
import { providerKeySupportsServiceTier } from "./service-tier.js";

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
	/**
	 * Canonical model id the credential will serve. Managed credentials
	 * restricted via `allowedModels` are skipped when they exclude it, falling
	 * through to the next credential or the env vars.
	 *
	 * Optional because several endpoints (embeddings, speech, OCR, …) only hold
	 * the upstream model id here — comparing that against the canonical ids in
	 * `allowedModels` would silently never match, which is worse than not
	 * filtering. Every chat-path caller passes it; a caller that omits it
	 * bypasses the restriction.
	 */
	model?: string;
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
 * Managed provider-key rows replace the `LLM_*` environment variables for
 * their provider — they are not tried before them. Once a provider has any
 * managed credential, its environment is out of play: if no managed credential
 * can serve this request (all excluded after failing, or none matching the
 * variant, region, model restriction or requested service tier) the request
 * fails rather than falling back to an env key the operator superseded.
 * Providers with no managed credential yet keep reading the environment
 * exactly as before, so migrating can be done a provider at a time.
 */
export async function resolvePlatformCredential(
	provider: Provider,
	options: ResolvePlatformCredentialOptions,
): Promise<PlatformCredential> {
	const restrictedToModel = options.model;
	const managedKey = await findManagedProviderKey(provider, {
		variant: options.variant,
		region: options.region,
		selectionScope: options.selectionScope,
		excludedKeyIds: options.excludedProviderKeyIds,
		filter: combineFilters(
			options.filter,
			options.requiresServiceTier ? providerKeySupportsServiceTier : undefined,
			restrictedToModel !== undefined
				? (key) => providerKeyAllowsModel(key.allowedModels, restrictedToModel)
				: undefined,
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

	if (await hasManagedProviderCredential(provider)) {
		// The scope is what makes this actionable: the fleet is never empty here,
		// so the operator needs to know which axis excluded every credential.
		const scope = [
			`region: ${options.region ?? "default"}`,
			`variant: ${options.variant ?? "default"}`,
			...(restrictedToModel !== undefined
				? [`model: ${restrictedToModel}`]
				: []),
			...(options.requiresServiceTier ? ["service tier: required"] : []),
			...(options.excludedProviderKeyIds?.size
				? [`excluded: ${options.excludedProviderKeyIds.size}`]
				: []),
		].join(", ");
		throw new HTTPException(500, {
			message: `No managed credential available for provider: ${provider} (${scope})`,
		});
	}

	// A provider that exists only in the DB (a custom Airside carrier) has no
	// LLM_* env vars to fall back to — a managed credential is the only way
	// the platform can serve it, so say that instead of an env-var error.
	if (!providers.some((p) => p.id === provider)) {
		throw new HTTPException(400, {
			message: `No platform credential is configured for provider: ${provider}. Add a managed credential in the admin dashboard.`,
		});
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
 * A database-backed credential is self-contained and never falls back to the
 * environment: a managed credential carries its settings in `config`, and a
 * BYOK key carries them in its own columns/options (`baseUrl`,
 * `google_vertex_project_id`, …) which the caller reads first. Only requests on
 * the env-var path read the provider's `LLM_*` var. This mirrors
 * `getProviderEndpoint`'s `skipEnvVars`, so an org's own key is never sent to
 * the deployment's proxy or stamped with the platform's GCP project.
 *
 * Endpoints that call `getProviderEndpoint` don't need this — passing
 * `managedCredentialOptions(managedKey)` covers them. It exists for the
 * endpoints (embeddings, speech, OCR, transcriptions, video, realtime,
 * moderations) that build their upstream URL themselves.
 */
export function getCredentialSetting(
	provider: Provider,
	key: string,
	credential: {
		providerKey?: ProviderKeyRow;
		managedKey?: ProviderKeyRow;
	},
	options: {
		configIndex?: number;
		defaultValue?: string;
		variant?: EnvVarVariant;
	} = {},
): string | undefined {
	if (credential.providerKey) {
		return options.defaultValue;
	}
	if (credential.managedKey) {
		return credential.managedKey.config?.[key] ?? options.defaultValue;
	}
	return getProviderEnvValue(
		provider,
		key,
		options.configIndex,
		options.defaultValue,
		options.variant,
	);
}
