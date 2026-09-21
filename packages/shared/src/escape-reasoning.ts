import { expandAllProviderRegions, models } from "@llmgateway/models";

export function getEscapeReasoningEffort(selection: string): "low" | undefined {
	const [target, region] = selection.split(":");
	const [providerId, modelId] = target.includes("/")
		? target.split("/", 2)
		: [undefined, target];
	const model = models.find((entry) => entry.id === modelId);
	if (!model) {
		return undefined;
	}
	const supported = expandAllProviderRegions(model.providers).some(
		(mapping) =>
			(!providerId || mapping.providerId === providerId) &&
			(!region || mapping.region === region) &&
			mapping.reasoning === true &&
			(!mapping.reasoningEfforts || mapping.reasoningEfforts.includes("low")),
	);
	return supported ? "low" : undefined;
}
