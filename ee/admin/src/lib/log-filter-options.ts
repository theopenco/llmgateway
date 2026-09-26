import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";

export function buildLogProviderOptions() {
	return providerDefinitions
		.map((p) => ({ id: p.id, label: p.name }))
		.toSorted((a, b) => a.label.localeCompare(b.label));
}

export function buildLogModelOptions() {
	return (modelDefinitions as readonly ModelDefinition[])
		.map((m) => ({
			id: m.id,
			label: m.name ?? m.id,
			aliases: m.aliases ?? [],
			providerIds: Array.from(
				new Set(m.providers.map((p) => p.providerId)),
			).toSorted(),
		}))
		.toSorted((a, b) => a.label.localeCompare(b.label));
}
