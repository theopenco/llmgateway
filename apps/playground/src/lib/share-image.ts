// Share snapshots carry client-supplied image bytes. The OG renderer decodes
// whatever it is handed: malformed headers throw inside it, and a small file
// declaring huge dimensions decodes into gigabytes. Only well-formed headers
// within these bounds are embedded.
export const MAX_SHARE_IMAGE_SIDE = 8192;
export const MAX_SHARE_IMAGE_PIXELS = 2048 * 4096;

export type ShareImageType =
	"image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ShareImageInfo {
	mediaType: ShareImageType;
	width: number;
	height: number;
}

interface Dimensions {
	width: number;
	height: number;
}

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
	if (bytes.length < offset + prefix.length) {
		return false;
	}
	return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
	return Array.from(text, (char) => char.charCodeAt(0));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngDimensions(bytes: Uint8Array, view: DataView): Dimensions | null {
	// Signature, IHDR length and type, 13 bytes of IHDR data, CRC.
	if (bytes.length < 33 || !startsWith(bytes, ascii("IHDR"), 12)) {
		return null;
	}
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifDimensions(view: DataView): Dimensions | null {
	if (view.byteLength < 10) {
		return null;
	}
	return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function isJpegFrameMarker(marker: number): boolean {
	return (
		marker >= 0xc0 &&
		marker <= 0xcf &&
		marker !== 0xc4 &&
		marker !== 0xc8 &&
		marker !== 0xcc
	);
}

function uint24le(view: DataView, offset: number): number {
	return view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
}

function jpegDimensions(view: DataView): Dimensions | null {
	let offset = 2;
	while (offset + 4 <= view.byteLength) {
		if (view.getUint8(offset) !== 0xff) {
			return null;
		}
		const marker = view.getUint8(offset + 1);
		if (marker === 0xff) {
			offset++;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) {
			// End of image or start of scan before any frame header.
			return null;
		}
		const length = view.getUint16(offset + 2);
		if (length < 2) {
			return null;
		}
		if (isJpegFrameMarker(marker)) {
			// Length, precision, height, width.
			if (length < 7 || offset + 9 > view.byteLength) {
				return null;
			}
			return {
				height: view.getUint16(offset + 5),
				width: view.getUint16(offset + 7),
			};
		}
		offset += 2 + length;
	}
	return null;
}

function webpDimensions(bytes: Uint8Array, view: DataView): Dimensions | null {
	if (bytes.length < 30 || !startsWith(bytes, ascii("WEBP"), 8)) {
		return null;
	}
	if (startsWith(bytes, ascii("VP8 "), 12)) {
		if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
			return null;
		}
		return {
			width: view.getUint16(26, true) & 0x3fff,
			height: view.getUint16(28, true) & 0x3fff,
		};
	}
	if (startsWith(bytes, ascii("VP8L"), 12)) {
		if (bytes[20] !== 0x2f) {
			return null;
		}
		const bits = view.getUint32(21, true);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >>> 14) & 0x3fff) + 1,
		};
	}
	if (startsWith(bytes, ascii("VP8X"), 12)) {
		return {
			width: uint24le(view, 24) + 1,
			height: uint24le(view, 27) + 1,
		};
	}
	return null;
}

function sniff(
	bytes: Uint8Array,
	view: DataView,
): { mediaType: ShareImageType; dimensions: Dimensions | null } | null {
	if (startsWith(bytes, PNG_SIGNATURE)) {
		return { mediaType: "image/png", dimensions: pngDimensions(bytes, view) };
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
		return { mediaType: "image/jpeg", dimensions: jpegDimensions(view) };
	}
	if (
		startsWith(bytes, ascii("GIF87a")) ||
		startsWith(bytes, ascii("GIF89a"))
	) {
		return { mediaType: "image/gif", dimensions: gifDimensions(view) };
	}
	if (startsWith(bytes, ascii("RIFF"))) {
		return {
			mediaType: "image/webp",
			dimensions: webpDimensions(bytes, view),
		};
	}
	return null;
}

/**
 * Identifies the image format from its bytes (never the declared type) and
 * returns it with its dimensions, or null when the header is malformed or
 * the image is too large to decode safely.
 */
export function inspectShareImage(bytes: Uint8Array): ShareImageInfo | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const result = sniff(bytes, view);
	if (!result?.dimensions) {
		return null;
	}
	const { width, height } = result.dimensions;
	if (
		width < 1 ||
		height < 1 ||
		width > MAX_SHARE_IMAGE_SIDE ||
		height > MAX_SHARE_IMAGE_SIDE ||
		width * height > MAX_SHARE_IMAGE_PIXELS
	) {
		return null;
	}
	return { mediaType: result.mediaType, width, height };
}
