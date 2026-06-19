import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertSafeUserContentUrl } from "./url-safety-node.js";

describe("assertSafeUserContentUrl", () => {
	const originalFlag = process.env.ALLOW_INSECURE_PROVIDER_URLS;

	afterEach(() => {
		if (originalFlag === undefined) {
			delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		} else {
			process.env.ALLOW_INSECURE_PROVIDER_URLS = originalFlag;
		}
	});

	describe("with the guard enabled", () => {
		beforeEach(() => {
			delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		});

		it("rejects http URLs before any DNS lookup", async () => {
			await expect(
				assertSafeUserContentUrl("http://cdn.example.com/x.png"),
			).rejects.toThrow("Content URL must use https");
		});

		it("rejects private/reserved IP literals before any DNS lookup", async () => {
			for (const url of [
				"https://127.0.0.1/x.png",
				"https://169.254.169.254/x.png",
				"https://10.0.0.5/x.png",
				"https://[::1]/x.png",
			]) {
				await expect(assertSafeUserContentUrl(url)).rejects.toThrow();
			}
		});

		it("rejects internal hostnames before any DNS lookup", async () => {
			await expect(
				assertSafeUserContentUrl("https://metadata.google.internal/x"),
			).rejects.toThrow("disallowed internal host");
		});

		it("passes through data URLs without a network fetch", async () => {
			await expect(
				assertSafeUserContentUrl("data:image/png;base64,iVBORw0KGgo="),
			).resolves.toBeUndefined();
		});
	});

	describe("with the guard disabled", () => {
		beforeEach(() => {
			process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
		});

		it("is a no-op even for http and internal targets", async () => {
			await expect(
				assertSafeUserContentUrl("http://localhost:8080/x.png"),
			).resolves.toBeUndefined();
			await expect(
				assertSafeUserContentUrl("http://169.254.169.254/x.png"),
			).resolves.toBeUndefined();
		});
	});
});
