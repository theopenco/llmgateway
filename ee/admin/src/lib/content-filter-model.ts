// The gateway logs a request its content filter blocks with no model (provider
// "llmgateway"), so blocked requests roll up under an empty usedModel.
export function contentFilterModelLabel(usedModel: string): string {
	return usedModel || "Blocked before reaching a model";
}
