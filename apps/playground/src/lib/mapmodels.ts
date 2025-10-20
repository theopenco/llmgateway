import type { ComboboxModel } from "@/lib/types";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

export function mapModels(
	models: readonly ModelDefinition[],
	providers: readonly ProviderDefinition[],
): ComboboxModel[] {
	const entries: ComboboxModel[] = [];
	for (const m of models) {
		for (const p of m.providers) {
			const providerInfo = providers.find((pr) => pr.id === p.providerId);
			entries.push({
				id: `${p.providerId}/${p.modelName}`,
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
