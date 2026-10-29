import { eq } from "drizzle-orm";

import {
	applyDeclaredCompliance,
	providers,
	type ProviderDefinition,
} from "@llmgateway/models";

import { cdb } from "./cdb.js";
import { providerClaim } from "./schema.js";

/**
 * The static catalogue with each claimed provider's declared certifications,
 * plus custom Airside carriers. Cache only database facts: rolling deployments
 * may have different catalogues.
 */
export async function getEffectiveProviders(): Promise<ProviderDefinition[]> {
	const claims = await cdb
		.select({
			id: providerClaim.providerId,
			kind: providerClaim.kind,
			name: providerClaim.customName,
			baseUrl: providerClaim.customBaseUrl,
			description: providerClaim.customDescription,
			website: providerClaim.website,
			termsUrl: providerClaim.termsUrl,
			privacyPolicyUrl: providerClaim.privacyPolicyUrl,
			statusPageUrl: providerClaim.statusPageUrl,
			legalEntity: providerClaim.legalEntity,
			headquarters: providerClaim.headquarters,
			apiTraining: providerClaim.apiTraining,
			promptLogging: providerClaim.promptLogging,
			retentionPeriod: providerClaim.retentionPeriod,
			gdpr: providerClaim.gdpr,
			soc2: providerClaim.soc2,
			iso27001: providerClaim.iso27001,
		})
		.from(providerClaim)
		.where(eq(providerClaim.status, "active"));
	const catalogueClaims = new Map(
		claims
			.filter((claim) => claim.kind === "catalogue")
			.map((claim) => [claim.id, claim]),
	);
	return [
		...providers.map((provider) => {
			const claim = catalogueClaims.get(provider.id);
			return claim
				? {
						...provider,
						dataPolicy: applyDeclaredCompliance(provider.dataPolicy, claim),
					}
				: provider;
		}),
		...claims
			.filter(
				(claim) => claim.baseUrl && !providers.some((p) => p.id === claim.id),
			)
			.map((claim): ProviderDefinition => ({
				id: claim.id,
				name: claim.name ?? claim.id,
				description: claim.description ?? "",
				website: claim.website,
				termsUrl: claim.termsUrl,
				privacyPolicyUrl: claim.privacyPolicyUrl,
				statusPageUrl: claim.statusPageUrl,
				legalEntity: claim.legalEntity,
				headquarters: claim.headquarters,
				env: { required: {} },
				forwardsSafetyIdentifier: false,
				managedInAirside: true,
				dataPolicy: {
					apiTraining: claim.apiTraining,
					promptLogging: claim.promptLogging,
					retentionPeriod: claim.retentionPeriod,
					gdpr: claim.gdpr,
					soc2: claim.soc2 === 1 || claim.soc2 === 2 ? claim.soc2 : null,
					iso27001: claim.iso27001,
				},
			})),
	];
}
