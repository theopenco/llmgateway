import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	ENTERPRISE_LICENSE_AUDIENCE,
	ENTERPRISE_LICENSE_GRACE_MS,
	ENTERPRISE_LICENSE_ISSUER,
	evaluateEnterpriseLicense,
	hasOrganizationEnterpriseAccessForLicense,
	hasWhiteLabelAccessForLicense,
	verifyEnterpriseLicense,
} from "./enterprise-license.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeys = {
	test: publicKey.export({ format: "pem", type: "spki" }).toString(),
};

function createToken(overrides: Record<string, unknown> = {}): string {
	const now = Math.floor(new Date("2026-01-01T00:00:00.000Z").getTime() / 1000);
	const header = Buffer.from(
		JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "test" }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iss: ENTERPRISE_LICENSE_ISSUER,
			aud: ENTERPRISE_LICENSE_AUDIENCE,
			ver: 1,
			kind: "enterprise",
			jti: "license-id",
			sub: "customer-id",
			organizationId: "organization-id",
			iat: now,
			exp: now + 60,
			entitlements: ["enterprise"],
			maxSeats: 25,
			...overrides,
		}),
	).toString("base64url");
	const input = `${header}.${payload}`;
	const signature = sign(null, Buffer.from(input), privateKey);
	return `${input}.${signature.toString("base64url")}`;
}

describe("enterprise license", () => {
	it("verifies a valid signed license", () => {
		expect(
			verifyEnterpriseLicense(createToken(), publicKeys)?.claims.maxSeats,
		).toBe(25);
	});

	it.each([
		["unknown issuer", { iss: "https://example.com" }],
		["unknown audience", { aud: "other" }],
		["unknown version", { ver: 2 }],
		["unknown license kind", { kind: "other" }],
		["missing organization scope", { organizationId: undefined }],
		["missing entitlement", { entitlements: [] }],
		["invalid seat cap", { maxSeats: 0 }],
	])("rejects %s", (_name, overrides) => {
		expect(
			verifyEnterpriseLicense(createToken(overrides), publicKeys),
		).toBeNull();
	});

	it("accepts an unbound white-label license", () => {
		const token = createToken({
			kind: "white_label",
			organizationId: undefined,
			entitlements: ["enterprise", "white_label"],
		});
		expect(verifyEnterpriseLicense(token, publicKeys)?.claims.kind).toBe(
			"white_label",
		);
	});

	it("scopes standard licenses to one organization", () => {
		const now = new Date("2026-01-01T00:00:30.000Z");
		const standard = evaluateEnterpriseLicense(createToken(), now, publicKeys);
		const whiteLabel = evaluateEnterpriseLicense(
			createToken({
				kind: "white_label",
				organizationId: undefined,
				entitlements: ["enterprise", "white_label"],
			}),
			now,
			publicKeys,
		);

		expect(
			hasOrganizationEnterpriseAccessForLicense(
				standard,
				"organization-id",
				"enterprise",
			),
		).toBe(true);
		expect(
			hasOrganizationEnterpriseAccessForLicense(
				standard,
				"another-organization",
				"enterprise",
			),
		).toBe(false);
		expect(
			hasOrganizationEnterpriseAccessForLicense(
				whiteLabel,
				"another-organization",
				"enterprise",
			),
		).toBe(true);
		expect(hasWhiteLabelAccessForLicense(standard)).toBe(false);
		expect(hasWhiteLabelAccessForLicense(whiteLabel)).toBe(true);
	});

	it("rejects unknown keys and modified signatures", () => {
		const token = createToken();
		const signatureStart = token.lastIndexOf(".") + 1;
		const modifiedSignature = `${token.slice(0, signatureStart)}${
			token[signatureStart] === "A" ? "B" : "A"
		}${token.slice(signatureStart + 1)}`;
		expect(verifyEnterpriseLicense(token, {})).toBeNull();
		expect(verifyEnterpriseLicense(modifiedSignature, publicKeys)).toBeNull();
	});

	it("evaluates not-before, active, grace, and expired boundaries", () => {
		const exp = Math.floor(
			new Date("2026-01-02T00:00:00.000Z").getTime() / 1000,
		);
		const expMs = exp * 1000;
		const token = createToken({ nbf: exp - 60, exp });
		expect(
			evaluateEnterpriseLicense(token, new Date((exp - 61) * 1000), publicKeys)
				.status,
		).toBe("not_yet_valid");
		expect(
			evaluateEnterpriseLicense(token, new Date((exp - 1) * 1000), publicKeys)
				.status,
		).toBe("active");
		expect(
			evaluateEnterpriseLicense(token, new Date(expMs), publicKeys).status,
		).toBe("grace");
		expect(
			evaluateEnterpriseLicense(
				token,
				new Date(expMs + (ENTERPRISE_LICENSE_GRACE_MS - 1)),
				publicKeys,
			).status,
		).toBe("grace");
		expect(
			evaluateEnterpriseLicense(
				token,
				new Date(expMs + ENTERPRISE_LICENSE_GRACE_MS),
				publicKeys,
			).status,
		).toBe("expired");
	});

	it("distinguishes missing and malformed licenses", () => {
		expect(evaluateEnterpriseLicense(undefined).status).toBe("missing");
		expect(evaluateEnterpriseLicense("secret-license-value").status).toBe(
			"invalid",
		);
	});
});
