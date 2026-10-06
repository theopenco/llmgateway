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
	const now = new Date();
	return models.map((model) => {
		const owned = listings.filter((listing) => listing.modelId === model.id);
		const ownedIds = new Set(owned.map((listing) => listing.providerId));
		const ids = new Set(
			(model.providers as ProviderModelMapping[])
				.filter(
					(mapping) =>
						!ownedIds.has(mapping.providerId) &&
						(!mapping.deactivatedAt || mapping.deactivatedAt > now),
				)
				.map((mapping) => mapping.providerId as string),
		);
		for (const listing of owned) {
			if (
				listing.status === "active" &&
				(!listing.deactivatedAt || listing.deactivatedAt > now) &&
				(providers.some((provider) => provider.id === listing.providerId) ||
					carriers.has(listing.providerId))
			) {
				ids.add(listing.providerId);
			}
		}
		return {
			modelId: model.id as string,
			providers: [...ids].map((id) => {
				const definition = providers.find((provider) => provider.id === id);
				return {
					id,
					name:
						carriers.get(id)?.customName ??
						owned.find((listing) => listing.providerId === id)?.provider
							?.name ??
						definition?.name ??
						id,
					color: definition?.color,
				};
			}),
		};
	});
}
