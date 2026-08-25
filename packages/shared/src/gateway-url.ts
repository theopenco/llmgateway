export function getGatewayPublicBaseUrl(): string {
	const configuredGatewayUrl = process.env.GATEWAY_URL?.trim();
	if (configuredGatewayUrl) {
		return configuredGatewayUrl;
	}

	return process.env.NODE_ENV === "production"
		? "https://api.llmgateway.io"
		: "http://localhost:4001";
}

export function getGatewayApiBaseUrl(): string {
	return `${getGatewayPublicBaseUrl()}/v1`;
}

export function buildGatewayVideoLogContentUrl(logId: string): string {
	return new URL(
		`/v1/videos/logs/${logId}/content`,
		`${getGatewayPublicBaseUrl()}/`,
	).toString();
}
