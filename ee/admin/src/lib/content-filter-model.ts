// Chat blocks logged before the routed model was recorded roll up under an
// empty usedModel (provider "llmgateway").
export function contentFilterModelLabel(usedModel: string): string {
	return usedModel || "Blocked (model not recorded)";
}
