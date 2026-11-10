export type ImageFormat = "png" | "jpeg" | "webp" | "svg" | "gif";

export function imageMimeType(format: ImageFormat): string {
	return format === "svg" ? "image/svg+xml" : `image/${format}`;
}

export function imageFormatFromBase64(b64: string): ImageFormat | undefined {
	const header = Buffer.from(b64.slice(0, 16), "base64");
	if (
		header.length >= 8 &&
		header
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	) {
		return "png";
	}
	if (
		header.length >= 3 &&
		header[0] === 0xff &&
		header[1] === 0xd8 &&
		header[2] === 0xff
	) {
		return "jpeg";
	}
	if (
		header.length >= 12 &&
		header.toString("latin1", 0, 4) === "RIFF" &&
		header.toString("latin1", 8, 12) === "WEBP"
	) {
		return "webp";
	}
	const signature = header.toString("ascii", 0, 6);
	if (signature === "GIF87a" || signature === "GIF89a") {
		return "gif";
	}
	return isSvgDocument(b64) ? "svg" : undefined;
}

const SVG_PREFIX_BASE64_CHARS = 2048;
const SVG_PROLOG = /^(?:\s+|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i;

// An SVG document may open with a byte order mark, whitespace, an XML
// declaration, comments, or a doctype before its root <svg> element.
function isSvgDocument(b64: string): boolean {
	const text = Buffer.from(b64.slice(0, SVG_PREFIX_BASE64_CHARS), "base64")
		.toString("utf8")
		.replace(/^\uFEFF/, "");
	return /^<svg[\s/>]/i.test(text.replace(SVG_PROLOG, ""));
}
