/**
 * Parses a file object containing image data and returns a properly formatted data URL
 * and normalized media type.
 *
 * Handles:
 * - Normalizing mediaType from various property names (mediaType, mime_type)
 * - Detecting existing data: URLs
 * - Detecting base64-looking content
 * - Stripping whitespace from base64 content
 * - Building proper data:...;base64,... URLs
 */
export function parseImageFile(file: {
	url?: string;
	mediaType?: string;
	mime_type?: string;
}): { dataUrl: string; mediaType: string } {
	const mediaType = file.mediaType || file.mime_type || "image/png";
	let url = String(file.url || "");

	const isDataUrl = url.startsWith("data:");
	const looksLikeBase64 =
		!isDataUrl && /^[A-Za-z0-9+/=\s]+$/.test(url.slice(0, 200));

	if (looksLikeBase64) {
		url = url.replace(/\s+/g, "");
	}

	const dataUrl = isDataUrl
		? url
		: looksLikeBase64
			? `data:${mediaType};base64,${url}`
			: url;

	return { dataUrl, mediaType };
}

/**
 * Extracts base64-only content from a data URL.
 * Returns empty string if the input is not a valid data URL.
 */
export function extractBase64FromDataUrl(dataUrl: string): string {
	if (!dataUrl.startsWith("data:")) {
		return "";
	}

	const comma = dataUrl.indexOf(",");
	return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

/**
 * Parses an image part (either image_url or file type) and returns
 * dataUrl, base64Only, and mediaType ready for rendering.
 *
 * Handles error cases gracefully by returning empty base64Only string
 * when parsing fails, allowing the renderer to skip invalid images.
 */
export function parseImagePartToDataUrl(part: any): {
	dataUrl: string;
	base64Only: string;
	mediaType: string;
} {
	try {
		// Handle image_url parts (e.g., from Google/gateway responses)
		if (part.type === "image_url" && part.image_url?.url) {
			const url = part.image_url.url;
			const mediaType = "image/png"; // Default for image_url parts

			if (url.startsWith("data:")) {
				// Extract media type from data URL if present
				const match = url.match(/data:([^;]+)/);
				const extractedMediaType = match?.[1] || mediaType;
				return {
					dataUrl: url,
					base64Only: extractBase64FromDataUrl(url),
					mediaType: extractedMediaType,
				};
			}

			return {
				dataUrl: url,
				base64Only: "",
				mediaType,
			};
		}

		// Handle file parts (AI SDK format)
		if (part.type === "file") {
			const { dataUrl, mediaType } = parseImageFile(part);
			return {
				dataUrl,
				base64Only: extractBase64FromDataUrl(dataUrl),
				mediaType,
			};
		}

		return {
			dataUrl: "",
			base64Only: "",
			mediaType: "image/png",
		};
	} catch {
		return {
			dataUrl: "",
			base64Only: "",
			mediaType: "image/png",
		};
	}
}
