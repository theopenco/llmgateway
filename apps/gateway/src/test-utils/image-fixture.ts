import { readFileSync } from "node:fs";

export function readFixtureImageDataUrl(): string {
	const bytes = readFileSync(
		new URL("../test-fixtures/test-image.png", import.meta.url),
	);
	return `data:image/png;base64,${bytes.toString("base64")}`;
}
