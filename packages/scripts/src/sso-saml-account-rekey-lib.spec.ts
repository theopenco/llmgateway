import { expect, test } from "vitest";

import {
	canDropLegacyMapping,
	hasLegacyMappingId,
	parseNameIdMap,
	planRekey,
	withoutLegacyMappingId,
	type SamlAccount,
} from "./sso-saml-account-rekey-lib.js";

// Ways the rekey can go wrong: it rewrites an account onto a NameID another
// user already holds, rewrites two accounts onto one NameID, deletes a legacy
// row whose NameID the user does not hold yet, rekeys object-id NameIDs the IdP
// asserts today, guesses a NameID it has no data for, or drops mapping.id while
// legacy rows are still unresolved.

const OID_A = "0b5e3c4a-1111-4a5b-8c9d-000000000001";
const OID_B = "0b5e3c4a-1111-4a5b-8c9d-000000000002";
const OID_C = "0b5e3c4a-1111-4a5b-8c9d-000000000003";
const OID_D = "0b5e3c4a-1111-4a5b-8c9d-000000000004";
const OID_E = "0b5e3c4a-1111-4a5b-8c9d-000000000005";
const OID_F = "0b5e3c4a-1111-4a5b-8c9d-000000000006";

function account(id: string, userId: string, accountId: string): SamlAccount {
	return { id, userId, accountId };
}

test("plans each legacy account once and leaves NameID accounts alone", () => {
	const actions = planRekey({
		accounts: [
			account("a1", "u-both", OID_A),
			account("a2", "u-both", "both@corp.example"),
			account("b1", "u-scim", OID_B),
			account("c1", "u-idp", OID_C),
			account("d1", "u-dup-original", OID_D),
			account("d2", "u-dup-new", "dup@corp.example"),
			account("e1", "u-none", OID_E),
			account("f1", "u-old-upn", OID_F),
			account("f2", "u-old-upn", "old@corp.example"),
			account("g1", "u-current", "current@corp.example"),
		],
		nameIdByObjectId: new Map([
			[OID_C, "Idp.User@corp.example"],
			[OID_F, "new@corp.example"],
		]),
		scimExternalIdByUser: new Map([
			["u-both", "both"],
			["u-scim", "scim"],
			["u-dup-original", "dup"],
			["u-idp", "ignored"],
		]),
		nameIdDomain: "corp.example",
		legacyMappingActive: true,
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
		{
			accountRowId: "f1",
			userId: "u-old-upn",
			objectId: OID_F,
			kind: "rewrite",
			nameId: "new@corp.example",
			source: "idp",
		},
	]);
	expect(canDropLegacyMapping(actions)).toBe(false);
});

test("deletes a legacy row without a known NameID only when the user has one", () => {
	const actions = planRekey({
		accounts: [
			account("a1", "u1", OID_A),
			account("a2", "u1", "u1@corp.example"),
		],
		nameIdByObjectId: new Map(),
		scimExternalIdByUser: new Map(),
		legacyMappingActive: true,
	});
	expect(actions).toEqual([
		{
			accountRowId: "a1",
			userId: "u1",
			objectId: OID_A,
			kind: "delete-redundant",
			nameId: "u1@corp.example",
		},
	]);
	expect(canDropLegacyMapping(actions)).toBe(true);
});

test("never rewrites two accounts onto the same NameID", () => {
	const actions = planRekey({
		accounts: [account("a1", "u1", OID_A), account("b1", "u2", OID_B)],
		nameIdByObjectId: new Map(),
		scimExternalIdByUser: new Map([
			["u1", "same"],
			["u2", "same"],
		]),
		nameIdDomain: "corp.example",
		legacyMappingActive: true,
	});
	expect(actions.map((a) => a.kind)).toEqual(["rewrite", "conflict"]);
});

test("compares NameIDs exactly, like the sign-in lookup", () => {
	const actions = planRekey({
		accounts: [
			account("a1", "u1", OID_A),
			account("b1", "u2", "User@corp.example"),
		],
		nameIdByObjectId: new Map([[OID_A, "user@corp.example"]]),
		scimExternalIdByUser: new Map(),
		legacyMappingActive: true,
	});
	expect(actions.map((a) => a.kind)).toEqual(["rewrite"]);
});

test("leaves object-id accounts alone once mapping.id is gone", () => {
	const actions = planRekey({
		accounts: [account("a1", "u1", OID_A)],
		nameIdByObjectId: new Map([[OID_A, "u1@corp.example"]]),
		scimExternalIdByUser: new Map([["u1", "u1"]]),
		nameIdDomain: "corp.example",
		legacyMappingActive: false,
	});
	expect(actions).toEqual([]);
});

test("does not derive a NameID without a domain", () => {
	const actions = planRekey({
		accounts: [account("a1", "u1", OID_A)],
		nameIdByObjectId: new Map(),
		scimExternalIdByUser: new Map([["u1", "user"]]),
		legacyMappingActive: true,
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

test("detects and strips only mapping.id from the stored SAML config", () => {
	const stored = JSON.stringify({
		entryPoint: "https://idp.example/saml2",
		mapping: { id: "objectidentifier", email: "emailaddress" },
	});
	expect(hasLegacyMappingId(stored)).toBe(true);
	expect(JSON.parse(withoutLegacyMappingId(stored) ?? "")).toEqual({
		entryPoint: "https://idp.example/saml2",
		mapping: { email: "emailaddress" },
	});
	const current = JSON.stringify({ mapping: { email: "e" } });
	expect(hasLegacyMappingId(current)).toBe(false);
	expect(withoutLegacyMappingId(current)).toBeNull();
	expect(
		withoutLegacyMappingId(JSON.stringify({ entryPoint: "x" })),
	).toBeNull();
});
