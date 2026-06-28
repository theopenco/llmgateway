const MODEL_PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const CHAT_MODEL_COOKIE = "llmgateway_model_chat";
export const IMAGE_MODEL_COOKIE = "llmgateway_model_image";
export const VIDEO_MODEL_COOKIE = "llmgateway_model_video";
export const AUDIO_MODEL_COOKIE = "llmgateway_model_audio";
export const CANVAS_MODEL_COOKIE = "llmgateway_model_canvas";

export function decodeModelPreference(
	value: string | undefined,
): string | null {
	if (!value) {
		return null;
	}

	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function getModelPreferenceCookie(name: string): string | null {
	if (typeof document === "undefined") {
		return null;
	}

	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${escapedName}=([^;]*)`),
	);

	return decodeModelPreference(match?.[1]);
}

export function setModelPreferenceCookie(name: string, value: string) {
	document.cookie = `${name}=${encodeURIComponent(
		value,
	)}; path=/; max-age=${MODEL_PREFERENCE_COOKIE_MAX_AGE}; samesite=lax`;
}
