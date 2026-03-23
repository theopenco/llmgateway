const AVALANCHE_API_BASE_PATH = "/api/v1/veo";

export function getAvalancheApiBaseUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	url.pathname = AVALANCHE_API_BASE_PATH;
	return url.toString();
}

export function getAvalancheFileUploadBaseUrl(
	baseUrl: string,
	fileUploadBaseUrl?: string,
): string {
	if (fileUploadBaseUrl) {
		return new URL(fileUploadBaseUrl).origin;
	}

	return new URL(baseUrl).origin;
}
