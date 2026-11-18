export function decodeBase64UrlNoPad(input: string): Buffer {
	const padded = input + "==".slice(0, (4 - (input.length % 4)) % 4);
	const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64, "base64");
}

export function encodeBase64UrlNoPad(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
