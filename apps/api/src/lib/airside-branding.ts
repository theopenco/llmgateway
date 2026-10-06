import { z } from "zod";

// Uploaded branding is stored inline as data URLs; keep them small. SVG only:
// vector marks scale cleanly everywhere the branding renders (cards, hero,
// OG images), and one accepted format keeps review simple.
export const LOGO_MAX_BYTES = 200 * 1024;
export const ICON_MAX_BYTES = 64 * 1024;
const DATA_URL_PATTERN = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/;

export function imageDataUrl(maxBytes: number) {
	return z
		.string()
		.regex(DATA_URL_PATTERN, "Must be a base64 SVG data URL")
		.refine((v) => v.length <= Math.ceil(maxBytes * 1.4), {
			message: `Image must be smaller than ${Math.round(maxBytes / 1024)}KB`,
		});
}
