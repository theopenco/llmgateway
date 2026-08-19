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
