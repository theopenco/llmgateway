import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { withAssetVersion } from "./asset-version.js";

describe("withAssetVersion", () => {
	const publicDir = mkdtempSync(path.join(tmpdir(), "asset-version-"));

	afterAll(() => {
		rmSync(publicDir, { recursive: true, force: true });
	});

	it("appends a stable content-hash query param", () => {
		writeFileSync(path.join(publicDir, "opengraph.png"), "image-content-v1");

		const versioned = withAssetVersion("/opengraph.png", publicDir);

		expect(versioned).toMatch(/^\/opengraph\.png\?v=[0-9a-f]{10}$/);
		expect(withAssetVersion("/opengraph.png", publicDir)).toBe(versioned);
	});

	it("produces different hashes for different file contents", () => {
		writeFileSync(path.join(publicDir, "a.png"), "content-a");
		writeFileSync(path.join(publicDir, "b.png"), "content-b");

		const a = withAssetVersion("/a.png", publicDir);
		const b = withAssetVersion("/b.png", publicDir);

		expect(a).not.toBe("/a.png");
		expect(a.split("?v=")[1]).not.toBe(b.split("?v=")[1]);
	});

	it("returns external URLs unchanged", () => {
		expect(withAssetVersion("https://example.com/og.png", publicDir)).toBe(
			"https://example.com/og.png",
		);
	});

	it("returns URLs with an existing query string unchanged", () => {
		writeFileSync(path.join(publicDir, "versioned.png"), "content");

		expect(withAssetVersion("/versioned.png?v=1", publicDir)).toBe(
			"/versioned.png?v=1",
		);
	});

	it("returns missing files unchanged", () => {
		expect(withAssetVersion("/does-not-exist.png", publicDir)).toBe(
			"/does-not-exist.png",
		);
	});
});
