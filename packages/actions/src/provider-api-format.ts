import type { Provider, ProviderApiFormat } from "@llmgateway/models";

export function getProviderApiTransport(
	provider: Provider,
	apiFormat: ProviderApiFormat | undefined,
): Provider {
	if (!apiFormat || apiFormat === "provider-native") {
		return provider;
	}
	return apiFormat === "google-vertex" ? "google-vertex" : "openai";
}
