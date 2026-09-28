export function getGatewayPublicBaseUrl(): string {
	const configuredGatewayUrl = process.env.GATEWAY_URL?.trim();
	if (configuredGatewayUrl) {
		return configuredGatewayUrl;
	}

	return process.env.NODE_ENV === "production"
		? "https://api.llmgateway.io"
		: "http://localhost:4001";
}

/** Server-to-server origin; keep public URLs for browsers and signed links. */
export function getGatewayBackendBaseUrl(): string {
	return (
		process.env.GATEWAY_BACKEND_URL?.trim() || getGatewayPublicBaseUrl()
	).replace(/\/+$/, "");
}

export function getGatewayApiBaseUrl(): string {
	return `${getGatewayBackendBaseUrl()}/v1`;
}

export function buildGatewayVideoLogContentUrl(logId: string): string {
	return new URL(
		`/v1/videos/logs/${logId}/content`,
		`${getGatewayPublicBaseUrl()}/`,
	).toString();
}
