import { describe, expect, test } from "vitest";

import { auth } from "./auth";

describe("auth configuration", () => {
	test("should have basic auth configuration", () => {
		expect(auth.options).toBeDefined();
		expect(auth.options.emailAndPassword).toEqual({ enabled: true });
		expect(auth.options.basePath).toBe("/auth");
		expect(auth.options.plugins).toBeDefined();
		expect(Array.isArray(auth.options.plugins)).toBe(true);
	});

	test("should not have server-specific features", () => {
		// The shared auth package should not have emailVerification or hooks
		expect(auth.options.emailVerification).toBeUndefined();
		expect(auth.options.hooks).toBeUndefined();
	});

	test("should have passkey plugin configured", () => {
		expect(auth.options.plugins?.length).toBeGreaterThan(0);
		// Check if passkey plugin is present by looking for its configuration
		const hasPasskeyPlugin = auth.options.plugins?.some(
			(plugin: any) =>
				plugin && typeof plugin === "object" && plugin.id === "passkey",
		);
		expect(hasPasskeyPlugin).toBe(true);
	});
});
