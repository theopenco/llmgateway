import { getGatewayPublicBaseUrl } from "@llmgateway/shared/gateway-url";

export function assertMcpHttpsUrl(url: string | URL): void {
	if (new URL(url).protocol !== "https:") {
		throw new Error("Authenticated MCP requests require an HTTPS URL.");
	}
}

function resolveBackendUrl(
	backendUrl: string | undefined,
	publicUrl: string,
): string {
	const backend = backendUrl?.trim();
	const url = backend || publicUrl;
	// Explicit backend URLs are deployment-controlled endpoints on a trusted
	// private network, like the frontend's API_BACKEND_URL.
	if (!backend || new URL(url).protocol !== "http:") {
		assertMcpHttpsUrl(url);
	}
	return url.replace(/\/+$/, "");
}

export function getMcpGatewayUrl(): string {
	const override = process.env.MCP_GATEWAY_URL;
	if (override !== undefined) {
		assertMcpHttpsUrl(override);
		return override.replace(/\/+$/, "");
	}
	return resolveBackendUrl(
		process.env.GATEWAY_BACKEND_URL,
		getGatewayPublicBaseUrl(),
	);
}

export function getMcpApiUrl(): string {
	return resolveBackendUrl(
		process.env.API_BACKEND_URL,
		process.env.API_URL ??
			(process.env.NODE_ENV === "production"
				? "https://internal.llmgateway.io"
				: "http://localhost:4002"),
	);
}
