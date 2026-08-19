import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { ComboboxModel } from "@/lib/types";

export function mapModels(
	models: readonly ApiModel[],
	providers: readonly ApiProvider[],
): ComboboxModel[] {
	const entries: ComboboxModel[] = [];
	for (const m of models) {
		// Add canonical model entry
		const canonicalProviders = m.mappings.map((p) => ({
			providerInfo: providers.find((pr) => pr.id === p.providerId),
			...p,
		}));

		// Determine capabilities based on if ANY provider supports them
		const hasVision = canonicalProviders.some((p) => p.vision);
		const hasAudio = canonicalProviders.some((p) => p.audio);
		const hasTools = canonicalProviders.some((p) => p.tools);
		const hasImageGen = m.output?.includes("image");
		const supportsVideoAudio = canonicalProviders.some(
			(p) => p.supportsVideoAudio !== false,
		);
		const supportsVideoWithoutAudio = canonicalProviders.some(
			(p) => p.supportsVideoWithoutAudio === true,
		);

		entries.push({
			id: m.id,
			name: m.name ?? m.id,
			provider: "Auto",
			providerId: undefined,
			family: m.family,
			vision: hasVision,
			audio: hasAudio,
			tools: hasTools,
			imageGen: hasImageGen,
			supportsVideoAudio,
			supportsVideoWithoutAudio,
			imageInputRequired: m.imageInputRequired ?? undefined,
		});

		for (const p of m.mappings) {
			const providerInfo = providers.find((pr) => pr.id === p.providerId);
			// Combobox id uses the canonical gateway model id, never the
			// provider-specific upstream id.

			entries.push({
				id: `${p.providerId}/${m.id}`,
				name: m.name ?? m.id,
				provider: providerInfo?.name ?? p.providerId,
				providerId: p.providerId,
				family: m.family,
				context: p.contextSize ?? undefined,
				inputPrice: p.inputPrice ? parseFloat(p.inputPrice) : undefined,
				outputPrice: p.outputPrice ? parseFloat(p.outputPrice) : undefined,
				vision: p.vision ?? undefined,
				audio: p.audio ?? undefined,
				tools: p.tools ?? undefined,
				imageGen: m.output?.includes("image"),
				supportsVideoAudio: p.supportsVideoAudio ?? undefined,
				supportsVideoWithoutAudio: p.supportsVideoWithoutAudio ?? undefined,
				imageInputRequired: m.imageInputRequired ?? undefined,
			});
		}
	}
	return entries;
}
