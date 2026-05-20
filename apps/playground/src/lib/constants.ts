export const PLAYGROUND_KEY_COOKIE_NAME = "llmgateway_playground_key";
export const PLAYGROUND_KEY_COOKIE_NAMES = [
	PLAYGROUND_KEY_COOKIE_NAME,
	`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`,
] as const;
