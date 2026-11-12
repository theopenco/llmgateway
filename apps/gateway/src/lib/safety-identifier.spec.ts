import { describe, expect, it } from "vitest";

import {
	getClientSafetyIdentifierParams,
	forwardedSafetyIdentifier,
} from "./safety-identifier.js";

describe("client safety identifier metadata", () => {
	it.each([
		undefined,
		null,
		1,
		[],
		{},
		{ safety_identifier: 42 },
		{ safety_identifier: "" },
		{ safety_identifier: "a".repeat(129) },
	])("ignores missing or invalid identifiers: %j", (body) => {
		expect(getClientSafetyIdentifierParams(body)).toEqual({});
	});
	it("prefers the explicit identifier over legacy user", () => {
		expect(
			getClientSafetyIdentifierParams({
				safety_identifier: "end-user",
				user: "legacy-user",
			}),
		).toEqual({ safety_identifier: "end-user" });
	});
	it("accepts legacy user and the maximum length", () => {
		expect(getClientSafetyIdentifierParams({ user: "a".repeat(128) })).toEqual({
			safety_identifier: "a".repeat(128),
		});
	});
});

describe("forwardedSafetyIdentifier", () => {
	it("forwards unless a managed credential turns it off", () => {
		expect(forwardedSafetyIdentifier(undefined, "key_a")).toBe("key_a");
		expect(
			forwardedSafetyIdentifier(
				{ managed: true, forwardSafetyIdentifier: true },
				"key_a",
			),
		).toBe("key_a");
		expect(
			forwardedSafetyIdentifier(
				{ managed: true, forwardSafetyIdentifier: false },
				"key_a",
			),
		).toBeUndefined();
	});
	it("ignores the setting on organization keys", () => {
		expect(
			forwardedSafetyIdentifier(
				{ managed: false, forwardSafetyIdentifier: false },
				"key_a",
			),
		).toBe("key_a");
	});
});
