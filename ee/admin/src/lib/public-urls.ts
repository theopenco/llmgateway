const PUBLIC_SITE_URL = "https://llmgateway.io";

export function publicModelUrl(modelId: string, providerId?: string) {
	const modelUrl = `${PUBLIC_SITE_URL}/models/${encodeURIComponent(modelId)}`;
	return providerId
		? `${modelUrl}/${encodeURIComponent(providerId)}`
		: modelUrl;
}
