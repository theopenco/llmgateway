import { HTTPException } from "hono/http-exception";

import { buildVerificationTarget } from "@/lib/model-verification.js";

import {
	runProviderKeySmokeTest,
	createAirsideGatewayFetch,
	airsideInferencePricing,
} from "@llmgateway/actions";
import { db, shortid } from "@llmgateway/db";
import {
	models,
	providers,
	type ProviderModelMapping,
	type ProviderValidationResult,
} from "@llmgateway/models";

import type { ProviderKeyOptions } from "@llmgateway/db";

/**
 * Model ids each provider serves through a live Airside listing. These live
 * only in the DB catalogue, so the static `@llmgateway/models` lookups never
 * see them.
 */
export async function listAirsideModelIds(
	providerIds: readonly string[],
	now: Date = new Date(),
): Promise<Map<string, string[]>> {
	const byProvider = new Map<string, string[]>();
	if (providerIds.length === 0) {
		return byProvider;
	}
	const listings = await db.query.modelProviderMapping.findMany({
		where: {
			providerId: { in: [...providerIds] },
			source: "airside",
			status: "active",
			region: { isNull: true },
		},
		columns: { providerId: true, modelId: true, deactivatedAt: true },
	});
	for (const listing of listings) {
		if (listing.deactivatedAt && listing.deactivatedAt <= now) {
			continue;
		}
		const ids = byProvider.get(listing.providerId) ?? [];
		if (!ids.includes(listing.modelId)) {
			ids.push(listing.modelId);
		}
		byProvider.set(listing.providerId, ids);
	}
	return byProvider;
}

export interface AirsideKeyProbeOptions {
	providerKeyOptions?: ProviderKeyOptions;
	skipEnvVars?: boolean;
	abortSignal?: AbortSignal;
	/** Operator-managed probes only; customer BYOK validation stays separate. */
	useGateway?: boolean;
	providerKeyId?: string;
	incomingHeaders?: HeadersInit;
}

/**
 * Probes a key through one of its provider's live Airside listings. Static
 * lookups never see these DB-only mappings, and a listing replaces the static
 * mapping of the same pair, as in gateway routing. A restricted key is probed
 * with its first listed allowed model; an unrestricted one only when the
 * provider has no live static mapping not owned by Airside. Undefined means
 * the static validation path applies.
 */
export async function validateAirsideKey(
	provider: string,
	token: string,
	baseUrl?: string,
	allowedModels?: string[] | null,
	options: AirsideKeyProbeOptions = {},
): Promise<ProviderValidationResult | undefined> {
	const isCatalogueProvider = providers.some((entry) => entry.id === provider);
	const [claim, mappings] = await Promise.all([
		isCatalogueProvider && !options.useGateway
			? undefined
			: db.query.providerClaim.findFirst({
					where: { providerId: provider, status: "active" },
				}),
		db.query.modelProviderMapping.findMany({
			where: {
				providerId: provider,
				...(!options.useGateway ? { source: "airside" as const } : {}),
				region: { isNull: true },
			},
		}),
	]);
	const now = new Date();
	const scopedMappings =
		options.useGateway && claim
			? mappings
			: mappings.filter((row) => row.source === "airside");
	const live = scopedMappings.filter(
		(row) =>
			row.status === "active" &&
			(!row.deactivatedAt || row.deactivatedAt > now),
	);
	let mapping: (typeof live)[number] | undefined;
	if (allowedModels?.length) {
		mapping = allowedModels
			.map((modelId) => live.find((row) => row.modelId === modelId))
			.find((row) => row !== undefined);
	} else {
		const owned = new Set(scopedMappings.map((row) => row.modelId));
		const hasStaticModel =
			isCatalogueProvider &&
			!claim &&
			models.some(
				(model) =>
					!owned.has(model.id) &&
					(model.providers as readonly ProviderModelMapping[]).some(
						(entry) =>
							entry.providerId === provider &&
							(!entry.deactivatedAt || entry.deactivatedAt > now),
					),
			);
		mapping = hasStaticModel ? undefined : live[0];
	}
	const carrierBaseUrl = isCatalogueProvider ? undefined : claim?.customBaseUrl;
	if (!mapping || (!isCatalogueProvider && !carrierBaseUrl)) {
		if (options.useGateway && (claim || !isCatalogueProvider)) {
			throw new HTTPException(503, {
				message: "No priced Airside deployment is available for verification.",
			});
		}
		return undefined;
	}
	const target = buildVerificationTarget({
		...mapping,
		modelName: mapping.modelId,
	});
	if (
		options.useGateway &&
		mapping.source === "airside" &&
		(typeof mapping.inputPrice !== "string" ||
			typeof mapping.outputPrice !== "string")
	) {
		throw new HTTPException(503, {
			message:
				"The Airside deployment pricing is unavailable for verification.",
		});
	}
	const { abortSignal } = options;
	let infrastructureError: Error | undefined;
	const inferenceFetch = options.useGateway
		? createAirsideGatewayFetch({
				runId: `managed-key:${shortid()}`,
				providerKeyId: options.providerKeyId,
				target,
				pricing: airsideInferencePricing(target, mapping),
				incomingHeaders: options.incomingHeaders,
				onInfrastructureError: (error) => {
					infrastructureError = error;
				},
			})
		: fetch;
	const failure = await runProviderKeySmokeTest({
		target,
		token,
		baseUrl: baseUrl ?? carrierBaseUrl ?? undefined,
		providerKeyOptions: options.providerKeyOptions,
		skipEnvVars: options.skipEnvVars ?? !isCatalogueProvider,
		fetchImplementation: abortSignal
			? async (input, init) =>
					await inferenceFetch(input, {
						...init,
						signal: init?.signal
							? AbortSignal.any([init.signal, abortSignal])
							: abortSignal,
					})
			: options.useGateway
				? inferenceFetch
				: undefined,
	});
	if (infrastructureError) {
		throw new HTTPException(503, {
			message: "The verification gateway is unavailable.",
		});
	}
	return {
		valid: !failure,
		model: mapping.modelId,
		error: failure ?? undefined,
	};
}
