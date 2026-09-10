// Custom provider names double as the model prefix in request model strings
// (e.g. "myprovider/some-model"), so the format is restricted.
export const CUSTOM_PROVIDER_NAME_REGEX = /^[a-z]+(-[a-z]+)*$/;

export const CUSTOM_PROVIDER_NAME_MESSAGE =
	"Name must contain only lowercase letters a-z and single hyphens between them";

// "dynamic" is the reserved model-string prefix for dynamic routes
// (e.g. "dynamic/support"), so a custom provider can never claim it.
export const RESERVED_CUSTOM_PROVIDER_NAMES = ["dynamic"] as const;

export const RESERVED_CUSTOM_PROVIDER_NAME_MESSAGE =
	"This name is reserved and cannot be used as a custom provider name";

// The gateway appends the endpoint path ("/v1/chat/completions" for an
// OpenAI-compatible carrier) to the base URL, so a base URL that already
// carries it would double up.
export const PROVIDER_BASE_URL_ENDPOINT_PATH_MESSAGE =
	"Enter the API base URL only — the gateway appends /v1/chat/completions itself, so the URL must not contain /v1 or /chat/completions.";

export function providerBaseUrlHasEndpointPath(rawUrl: string): boolean {
	let pathname: string;
	try {
		pathname = new URL(rawUrl.trim()).pathname;
	} catch {
		return false;
	}
	const segments = pathname.toLowerCase().split("/").filter(Boolean);
	return segments.some(
		(segment, index) =>
			segment === "v1" ||
			(segment === "chat" && segments[index + 1] === "completions"),
	);
}
