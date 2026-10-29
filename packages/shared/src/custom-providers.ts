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
	// URL.pathname keeps percent-encoding; the upstream decodes it.
	const segments = decodePathname(pathname)
		.toLowerCase()
		.split("/")
		.filter(Boolean);
	return segments.some(
		(segment, index) =>
			segment === "v1" ||
			(segment === "chat" && segments[index + 1] === "completions"),
	);
}

function decodePathname(pathname: string): string {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

// A BYOK base URL replaces a catalogue provider's endpoint wholesale, so the
// hosted service does not offer it: a provider is reached only at its published
// endpoint, parameterized by the key's own options (an Azure resource, a
// Bedrock region). Self-hosted deployments keep the override by default.
// ALLOW_PROVIDER_BASE_URL_OVERRIDE overrides either default. Custom providers
// are exempt — a base URL is what defines them.
export function isProviderBaseUrlOverrideAllowed(): boolean {
	const flag = process.env.ALLOW_PROVIDER_BASE_URL_OVERRIDE;
	if (flag === "true" || flag === "false") {
		return flag === "true";
	}
	return process.env.HOSTED !== "true";
}

export const PROVIDER_BASE_URL_OVERRIDE_DISABLED_MESSAGE =
	"A custom base URL cannot be set for this provider. Configure the provider's own settings instead, such as an Azure resource.";

// A resource, workspace or deployment id supplied on a provider key becomes a
// hostname label on the provider's own domain. Interpolating one blindly would
// let `evil.example.com/` smuggle a different host into the endpoint the
// gateway calls, so every such value is restricted to a single label.
export const PROVIDER_HOSTNAME_LABEL_REGEX = /^[a-zA-Z0-9-]{1,64}$/;

export const PROVIDER_HOSTNAME_LABEL_MESSAGE =
	"Must be 1-64 characters of letters, digits, or hyphens";

export function isProviderHostnameLabel(value: string): boolean {
	return PROVIDER_HOSTNAME_LABEL_REGEX.test(value);
}

// A Cloudflare account id is a URL path segment of the Workers AI endpoint.
export const CLOUDFLARE_ACCOUNT_ID_REGEX = /^[0-9a-f]{32}$/;

export const CLOUDFLARE_ACCOUNT_ID_MESSAGE =
	"Cloudflare account ID must be 32 lowercase hex characters";
