import { db } from "@llmgateway/db";
import {
	models,
	providers,
	type ProviderModelMapping,
} from "@llmgateway/models";

/** Static model choices with their currently active catalogue and Airside providers. */
export async function getDynamicRouteProviderOptions() {
	const [listings, claims] = await Promise.all([
		db.query.modelProviderMapping.findMany({
			where: { source: "airside", region: { isNull: true } },
			with: { provider: true },
		}),
		db.query.providerClaim.findMany({
			where: {
				kind: "custom",
				status: "active",
				customBaseUrl: { isNotNull: true },
			},
			columns: { providerId: true, customName: true },
		}),
	]);
	const carriers = new Map(claims.map((claim) => [claim.providerId, claim]));
	const listingsByModel = new Map<string, typeof listings>();
	for (const listing of listings) {
		const modelListings = listingsByModel.get(listing.modelId) ?? [];
		modelListings.push(listing);
		listingsByModel.set(listing.modelId, modelListings);
	}
	const providersById = new Map<string, (typeof providers)[number]>(
		providers.map((provider) => [provider.id, provider]),
	);
	const now = new Date();
	return models.map((model) => {
		const owned = listingsByModel.get(model.id) ?? [];
		const ownedByProvider = new Map<string, (typeof listings)[number]>();
		for (const listing of owned) {
			if (!ownedByProvider.has(listing.providerId)) {
				ownedByProvider.set(listing.providerId, listing);
			}
		}
		const ids = new Set(
			(model.providers as ProviderModelMapping[])
				.filter(
					(mapping) =>
						!ownedByProvider.has(mapping.providerId) &&
						(!mapping.deactivatedAt || mapping.deactivatedAt > now),
				)
				.map((mapping) => mapping.providerId as string),
		);
		for (const listing of owned) {
			if (
				listing.status === "active" &&
				(!listing.deactivatedAt || listing.deactivatedAt > now) &&
				(providersById.has(listing.providerId) ||
					carriers.has(listing.providerId))
			) {
				ids.add(listing.providerId);
			}
		}
		return {
			modelId: model.id as string,
			providers: [...ids].map((id) => {
				const definition = providersById.get(id);
				return {
					id,
					name:
						carriers.get(id)?.customName ??
						ownedByProvider.get(id)?.provider?.name ??
						definition?.name ??
						id,
					color: definition?.color,
				};
			}),
		};
	});
}
