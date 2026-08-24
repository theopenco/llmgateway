import { describe, expect, it } from "vitest";

import { providerKeyAllowsModel } from "./provider-key-allowed-models.js";

describe("providerKeyAllowsModel", () => {
	it("allows every model when no restriction is set", () => {
		expect(providerKeyAllowsModel(null, "gpt-5.2")).toBe(true);
		expect(providerKeyAllowsModel(undefined, "gpt-5.2")).toBe(true);
	});

	it("treats an empty list as unrestricted", () => {
		expect(providerKeyAllowsModel([], "gpt-5.2")).toBe(true);
	});

	it("allows only the listed models", () => {
		const allowed = ["claude-sonnet-4-6", "claude-haiku-4-5"];
		expect(providerKeyAllowsModel(allowed, "claude-sonnet-4-6")).toBe(true);
		expect(providerKeyAllowsModel(allowed, "claude-opus-4-6")).toBe(false);
	});

	it("matches exact canonical ids, never prefixes", () => {
		expect(providerKeyAllowsModel(["gpt-5.2"], "gpt-5")).toBe(false);
		expect(providerKeyAllowsModel(["gpt-5"], "gpt-5.2")).toBe(false);
	});
});
