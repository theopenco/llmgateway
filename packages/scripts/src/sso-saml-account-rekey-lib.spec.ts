import { expect, test } from "vitest";

import {
	parseNameIdMap,
	planRekey,
	withoutLegacyMappingId,
	type SamlAccount,
} from "./sso-saml-account-rekey-lib.js";

// Ways the rekey can go wrong: it rewrites an account onto a NameID another
// user already holds, rewrites two accounts onto one NameID, keeps a stale
// object-id row next to the user's NameID row, guesses a NameID it has no data
// for, or touches accounts that are already keyed by NameID.

const OID_A = "0b5e3c4a-1111-4a5b-8c9d-000000000001";
const OID_B = "0b5e3c4a-1111-4a5b-8c9d-000000000002";
const OID_C = "0b5e3c4a-1111-4a5b-8c9d-000000000003";
const OID_D = "0b5e3c4a-1111-4a5b-8c9d-000000000004";
const OID_E = "0b5e3c4a-1111-4a5b-8c9d-000000000005";

function account(id: string, userId: string, accountId: string): SamlAccount {
	return { id, userId, accountId };
}

test("plans each legacy account once and leaves NameID accounts alone", () => {
	const accounts = [
		account("a1", "u-both", OID_A),
		account("a2", "u-both", "both@corp.example"),
		account("b1", "u-scim", OID_B),
		account("c1", "u-idp", OID_C),
		account("d1", "u-dup-original", OID_D),
		account("d2", "u-dup-new", "dup@corp.example"),
		account("e1", "u-none", OID_E),
		account("f1", "u-current", "current@corp.example"),
	];
	const actions = planRekey({
		accounts,
		nameIdByObjectId: new Map([[OID_C, "Idp.User@corp.example"]]),
		scimExternalIdByUser: new Map([
			["u-scim", "scim"],
			["u-dup-original", "dup"],
			["u-idp", "ignored"],
		]),
		nameIdDomain: "corp.example",
	});

	expect(actions).toEqual([
		{
			accountRowId: "a1",
			userId: "u-both",
			objectId: OID_A,
			kind: "delete-redundant",
			nameId: "both@corp.example",
		},
		{
			accountRowId: "b1",
			userId: "u-scim",
			objectId: OID_B,
			kind: "rewrite",
			nameId: "scim@corp.example",
			source: "scim",
		},
		{
			accountRowId: "c1",
			userId: "u-idp",
			objectId: OID_C,
			kind: "rewrite",
			nameId: "Idp.User@corp.example",
			source: "idp",
		},
		{
			accountRowId: "d1",
			userId: "u-dup-original",
			objectId: OID_D,
			kind: "conflict",
			nameId: "dup@corp.example",
			heldByUserId: "u-dup-new",
		},
		{ accountRowId: "e1", userId: "u-none", objectId: OID_E, kind: "unmapped" },
	]);
});

test("never rewrites two accounts onto the same NameID", () => {
	const actions = planRekey({
		accounts: [account("a1", "u1", OID_A), account("b1", "u2", OID_B)],
		nameIdByObjectId: new Map(),
		scimExternalIdByUser: new Map([
			["u1", "same"],
			["u2", "SAME"],
		]),
		nameIdDomain: "corp.example",
	});
	expect(actions.map((a) => a.kind)).toEqual(["rewrite", "conflict"]);
});

test("does not derive a NameID without a domain", () => {
	const actions = planRekey({
		accounts: [account("a1", "u1", OID_A)],
		nameIdByObjectId: new Map(),
		scimExternalIdByUser: new Map([["u1", "user"]]),
	});
	expect(actions.map((a) => a.kind)).toEqual(["unmapped"]);
});

test("parses the IdP export and rejects malformed lines", () => {
	expect(
		parseNameIdMap(
			`# object id, NameID\n${OID_A.toUpperCase()}, a@corp.example\n\n`,
		),
	).toEqual(new Map([[OID_A, "a@corp.example"]]));
	expect(() => parseNameIdMap("not-a-guid,a@corp.example")).toThrow("Line 1");
	expect(() => parseNameIdMap(`${OID_A},a@corp.example,extra`)).toThrow();
});

test("strips only mapping.id from the stored SAML config", () => {
	const stored = JSON.stringify({
		entryPoint: "https://idp.example/saml2",
		mapping: { id: "objectidentifier", email: "emailaddress" },
	});
	expect(JSON.parse(withoutLegacyMappingId(stored) ?? "")).toEqual({
		entryPoint: "https://idp.example/saml2",
		mapping: { email: "emailaddress" },
	});
	expect(
		withoutLegacyMappingId(JSON.stringify({ mapping: { email: "e" } })),
	).toBeNull();
	expect(
		withoutLegacyMappingId(JSON.stringify({ entryPoint: "x" })),
	).toBeNull();
});
