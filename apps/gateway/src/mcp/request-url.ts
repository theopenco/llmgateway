export function assertMcpHttpsUrl(url: string | URL): void {
	if (new URL(url).protocol !== "https:") {
		throw new Error("Authenticated MCP requests require an HTTPS URL.");
	}
}
