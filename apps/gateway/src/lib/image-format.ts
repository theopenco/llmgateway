export type ImageFormat = "png" | "jpeg" | "webp";

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
	return undefined;
}
