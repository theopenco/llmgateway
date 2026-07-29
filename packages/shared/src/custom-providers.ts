// Custom provider names double as the model prefix in request model strings
// (e.g. "myprovider/some-model"), so the format is restricted.
export const CUSTOM_PROVIDER_NAME_REGEX = /^[a-z]+(-[a-z]+)*$/;

export const CUSTOM_PROVIDER_NAME_MESSAGE =
	"Name must contain only lowercase letters a-z and single hyphens between them";
