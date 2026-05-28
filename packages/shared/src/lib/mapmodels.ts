import type { ComboboxModel } from "./types";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

export function mapModels(
	models: readonly ModelDefinition[],
	providers: readonly ProviderDefinition[],
): ComboboxModel[] {
	const entries: ComboboxModel[] = [];
	for (const m of models) {
		// Add root model entry
		const rootProviders = m.providers.map((p) => ({
			providerInfo: providers.find((pr) => pr.id === p.providerId),
			...p,
		}));

		// Determine capabilities based on if ANY provider supports them
		const hasVision = rootProviders.some((p) => p.vision);
		const hasTools = rootProviders.some((p) => p.tools);
		const hasImageGen = m.output?.includes("image");

		entries.push({
			id: m.id,
			name: m.name ?? m.id,
			provider: "Auto",
			providerId: undefined,
			family: m.family,
			vision: hasVision,
			tools: hasTools,
			imageGen: hasImageGen,
		});

		for (const p of m.providers) {
			const providerInfo = providers.find((pr) => pr.id === p.providerId);
			// Combobox id uses the canonical gateway model id, never the
			// provider-specific upstream id.

			entries.push({
				id: `${p.providerId}/${m.id}`,
				name: m.name ?? m.id,
				provider: providerInfo?.name ?? p.providerId,
				providerId: p.providerId,
				family: m.family,
				context: p.contextSize,
				inputPrice: p.inputPrice,
				outputPrice: p.outputPrice,
				vision: p.vision,
				tools: p.tools,
				imageGen: m.output?.includes("image"),
			});
		}
	}
	return entries;
}
