import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
	versionedOgImage,
	withAssetVersion,
	withDeployVersion,
} from "./asset-version.js";

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

describe("withDeployVersion", () => {
	const originalVersion = process.env.APP_VERSION;

	afterEach(() => {
		if (originalVersion === undefined) {
			delete process.env.APP_VERSION;
		} else {
			process.env.APP_VERSION = originalVersion;
		}
	});

	it("appends the deployment version as a query param", () => {
		process.env.APP_VERSION = "v1.2.3";

		expect(withDeployVersion("/providers/opengraph-image")).toBe(
			"/providers/opengraph-image?v=v1.2.3",
		);
	});

	it("URL-encodes the version", () => {
		process.env.APP_VERSION = "feature/x";

		expect(withDeployVersion("/og")).toBe("/og?v=feature%2Fx");
	});

	it("returns the URL unchanged without APP_VERSION", () => {
		delete process.env.APP_VERSION;

		expect(withDeployVersion("/providers/opengraph-image")).toBe(
			"/providers/opengraph-image",
		);
	});

	it("returns URLs with an existing query string unchanged", () => {
		process.env.APP_VERSION = "v1.2.3";

		expect(withDeployVersion("/og?v=1")).toBe("/og?v=1");
	});

	it("versionedOgImage builds a versioned 1200x630 descriptor", () => {
		process.env.APP_VERSION = "v1.2.3";

		expect(versionedOgImage("/providers")).toEqual({
			url: "/providers/opengraph-image?v=v1.2.3",
			width: 1200,
			height: 630,
		});
	});
});
