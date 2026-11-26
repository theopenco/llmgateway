import { describe, expect, it } from "vitest";

import { responsesRequestSchema } from "@/responses/schemas.js";

import {
	clientSafetyIdentifierFields,
	formSafetyIdentifierFields,
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
	it("counts code points like the schema limit", () => {
		const emoji = "\u{1F600}".repeat(128);
		expect(getClientSafetyIdentifierParams({ user: emoji })).toEqual({
			safety_identifier: emoji,
		});
		expect(getClientSafetyIdentifierParams({ user: `${emoji}a` })).toEqual({});
	});
	it("does not fall back to user for an empty form safety_identifier", () => {
		const form = { safety_identifier: "", user: ["legacy-user", "other"] };
		expect(formSafetyIdentifierFields(form)).toEqual({
			safety_identifier: "",
			user: "legacy-user",
		});
		expect(
			getClientSafetyIdentifierParams(formSafetyIdentifierFields(form)),
		).toEqual({});
		expect(
			getClientSafetyIdentifierParams(
				formSafetyIdentifierFields({ user: "legacy-user" }),
			),
		).toEqual({ safety_identifier: "legacy-user" });
	});
	it("keeps accepting a non-string user", () => {
		expect(clientSafetyIdentifierFields.user.safeParse(42).success).toBe(true);
		expect(getClientSafetyIdentifierParams({ user: 42 })).toEqual({});
		expect(
			responsesRequestSchema.parse({ model: "m", input: "hi", user: 42 }).user,
		).toBeUndefined();
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
