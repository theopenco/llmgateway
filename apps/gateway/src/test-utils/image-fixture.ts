import { readFileSync } from "node:fs";

export function readFixtureImageDataUrl(): string {
	const bytes = readFileSync(
		new URL("../test-fixtures/test-image.png", import.meta.url),
	);
	return `data:image/png;base64,${bytes.toString("base64")}`;
}

// 720x720: above the minimum pixel count Seedance accepts for image inputs.
export function readLargeFixtureImageDataUrl(): string {
	const bytes = readFileSync(
		new URL("../test-fixtures/test-image-720.jpg", import.meta.url),
	);
	return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
