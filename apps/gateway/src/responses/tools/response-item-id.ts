import { createHash } from "node:crypto";

export function responseItemId(
	prefix: string,
	responseId: string,
	index: number,
): string {
	const suffix = createHash("sha256")
		.update(`${responseId}:${prefix}:${index}`)
		.digest("hex")
		.slice(0, 24);
	return `${prefix}_${suffix}`;
}
