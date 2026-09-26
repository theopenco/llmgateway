import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConfig } from "./config-server";

describe("PostHog host configuration", () => {
	beforeEach(() => {
		vi.stubEnv("NODE_ENV", "production");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([undefined, ""])("treats %j as an unset host", (host) => {
		vi.stubEnv("POSTHOG_HOST", host);
		expect(getConfig().posthogHost).toBeUndefined();
	});

	it("preserves a configured HTTPS host", () => {
		const host = "https://us.i.posthog.com";
		vi.stubEnv("POSTHOG_HOST", host);
		expect(getConfig().posthogHost).toBe(host);
	});

	it.each([
		"not-a-url",
		"http://us.i.posthog.com",
		"http://localhost:8080",
		"ftp://example.com",
	])("rejects %s in production", (host) => {
		vi.stubEnv("POSTHOG_HOST", host);
		expect(() => getConfig()).toThrow();
	});

	it.each(["localhost", "127.0.0.1", "[::1]"])(
		"allows HTTP on %s during development",
		(hostname) => {
			const host = `http://${hostname}:8080`;
			vi.stubEnv("NODE_ENV", "development");
			vi.stubEnv("POSTHOG_HOST", host);
			expect(getConfig().posthogHost).toBe(host);
		},
	);

	it("rejects remote HTTP hosts during development", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("POSTHOG_HOST", "http://example.com");
		expect(() => getConfig()).toThrow("POSTHOG_HOST must use HTTPS");
	});
});
