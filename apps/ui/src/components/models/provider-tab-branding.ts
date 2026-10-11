import type { ApiProvider } from "@/lib/fetch-models";

export interface ProviderTabBranding {
	name: string | null;
	markUrl: string | null;
}

/** Carrier-uploaded Airside branding for the providers shown as tabs. */
export function buildProviderTabBranding(
	providerIds: string[],
	apiProviders: ApiProvider[],
): Record<string, ProviderTabBranding> {
	const ids = new Set(providerIds);
	return Object.fromEntries(
		apiProviders
			.filter((p) => ids.has(p.id))
			.map((p) => [
				p.id,
				{
					name: p.name,
					markUrl: p.airsideIconUrl ?? p.airsideLogoUrl ?? null,
				},
			]),
	);
}
