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

		for (const p of m.mappings) {
			const providerInfo = providers.find((pr) => pr.id === p.providerId);
			// Ensure we use the same ID format as ModelSelector: providerId/modelId
			// Note: ModelSelector uses m.id (Gateway ID), not p.modelName (Provider ID)
			// We should match that to ensure lookups work if we looked up by provider-specific ID.
			// However, ChatPageClient uses mapModels primarily for capabilities lookup.
			// If ModelSelector uses providerId/m.id, we should probably align here or support both?
			// The existing code used providerId/p.modelName.
			// Let's keep p.modelName for now to avoid breaking if p.modelName is expected elsewhere,
			// but ideally it should be m.id.
			// Let's assume ModelSelector logic is the correct one for "User Selection".

			entries.push({
				id: `${p.providerId}/${m.id}`, // Changed to match ModelSelector
				name: m.name ?? m.id,
				provider: providerInfo?.name ?? p.providerId,
				providerId: p.providerId,
				family: m.family,
				context: p.contextSize ?? undefined,
				inputPrice: p.inputPrice ? parseFloat(p.inputPrice) : undefined,
				outputPrice: p.outputPrice ? parseFloat(p.outputPrice) : undefined,
				vision: p.vision ?? undefined,
				tools: p.tools ?? undefined,
				imageGen: m.output?.includes("image"),
			});
		}
	}
	return entries;
}
