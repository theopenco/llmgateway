import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { ComboboxModel } from "@/lib/types";

export function mapModels(
	models: readonly ApiModel[],
	providers: readonly ApiProvider[],
): ComboboxModel[] {
	const entries: ComboboxModel[] = [];
	for (const m of models) {
		// Add root model entry
		const rootProviders = m.mappings.map((p) => ({
			providerInfo: providers.find((pr) => pr.id === p.providerId),
			...p,
		}));

		// Determine capabilities based on if ANY provider supports them
		const hasVision = rootProviders.some((p) => p.vision);
		const hasAudio = rootProviders.some((p) => p.audio);
		const hasTools = rootProviders.some((p) => p.tools);
		const hasImageGen = m.output?.includes("image");
		const supportsVideoAudio = rootProviders.some(
			(p) => p.supportsVideoAudio !== false,
		);
		const supportsVideoWithoutAudio = rootProviders.some(
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
			});
		}
	}
	return entries;
}
