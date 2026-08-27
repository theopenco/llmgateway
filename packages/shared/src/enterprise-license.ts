import { createPublicKey, verify } from "node:crypto";

export const ENTERPRISE_LICENSE_ISSUER = "https://llmgateway.io";
export const ENTERPRISE_LICENSE_AUDIENCE = "llmgateway-enterprise";
export const ENTERPRISE_LICENSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const ENTERPRISE_LICENSE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
	"2026-08-01": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmutDOhT8U2WTFy5LvagoXXw26rQUcUWmKQmnu607I8g=
-----END PUBLIC KEY-----`,
};

export type EnterpriseLicenseState =
	| "missing"
	| "invalid"
	| "not_yet_valid"
	| "active"
	| "grace"
	| "expired"
	| "development";

export type EnterpriseLicenseKind = "enterprise" | "white_label";

export interface EnterpriseLicenseClaims {
	iss: typeof ENTERPRISE_LICENSE_ISSUER;
	aud: typeof ENTERPRISE_LICENSE_AUDIENCE;
	ver: 1;
	kind: EnterpriseLicenseKind;
	jti: string;
	sub: string;
	organizationId?: string;
	iat: number;
	nbf?: number;
	exp: number;
	entitlements: string[];
	maxSeats: number;
}

export interface EnterpriseLicenseStatus {
	status: EnterpriseLicenseState;
	enterpriseEnabled: boolean;
	expiresAt: string | null;
	graceEndsAt: string | null;
	maxSeats: number | null;
	kind: EnterpriseLicenseKind | null;
	organizationId: string | null;
	licenseId: string | null;
	keyId: string | null;
}

interface VerifiedEnterpriseLicense {
	claims: EnterpriseLicenseClaims;
	keyId: string;
}

function invalidStatus(
	status: EnterpriseLicenseState,
): EnterpriseLicenseStatus {
	return {
		status,
		enterpriseEnabled: status === "development",
		expiresAt: null,
		graceEndsAt: null,
		maxSeats: null,
		kind: status === "development" ? "white_label" : null,
		organizationId: null,
		licenseId: null,
		keyId: null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJson(value: string): unknown {
	return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function isValidClaims(value: unknown): value is EnterpriseLicenseClaims {
	if (!isRecord(value)) {
		return false;
	}
	const validScope =
		(value.kind === "enterprise" &&
			typeof value.organizationId === "string" &&
			value.organizationId.length > 0) ||
		(value.kind === "white_label" && value.organizationId === undefined);
	const validEntitlements =
		Array.isArray(value.entitlements) &&
		value.entitlements.every((item) => typeof item === "string") &&
		value.entitlements.includes("enterprise") &&
		(value.kind !== "white_label" ||
			value.entitlements.includes("white_label"));

	return (
		value.iss === ENTERPRISE_LICENSE_ISSUER &&
		value.aud === ENTERPRISE_LICENSE_AUDIENCE &&
		value.ver === 1 &&
		validScope &&
		typeof value.jti === "string" &&
		value.jti.length > 0 &&
		typeof value.sub === "string" &&
		value.sub.length > 0 &&
		Number.isInteger(value.iat) &&
		(value.nbf === undefined || Number.isInteger(value.nbf)) &&
		Number.isInteger(value.exp) &&
		(value.iat as number) <= (value.exp as number) &&
		(value.nbf === undefined ||
			(value.nbf as number) <= (value.exp as number)) &&
		validEntitlements &&
		Number.isInteger(value.maxSeats) &&
		(value.maxSeats as number) > 0
	);
}

export function verifyEnterpriseLicense(
	token: string,
	publicKeys: Readonly<Record<string, string>> = ENTERPRISE_LICENSE_PUBLIC_KEYS,
): VerifiedEnterpriseLicense | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
			return null;
		}

		const [encodedHeader, encodedPayload, encodedSignature] = parts;
		const header = decodeJson(encodedHeader);
		const claims = decodeJson(encodedPayload);
		if (
			!isRecord(header) ||
			header.alg !== "EdDSA" ||
			header.typ !== "JWT" ||
			typeof header.kid !== "string" ||
			!isValidClaims(claims)
		) {
			return null;
		}

		const publicKey = publicKeys[header.kid];
		if (!publicKey) {
			return null;
		}

		const verified = verify(
			null,
			Buffer.from(`${encodedHeader}.${encodedPayload}`),
			createPublicKey(publicKey),
			Buffer.from(encodedSignature, "base64url"),
		);
		return verified ? { claims, keyId: header.kid } : null;
	} catch {
		return null;
	}
}

export function evaluateEnterpriseLicense(
	token: string | undefined,
	now: Date = new Date(),
	publicKeys: Readonly<Record<string, string>> = ENTERPRISE_LICENSE_PUBLIC_KEYS,
): EnterpriseLicenseStatus {
	if (!token) {
		return invalidStatus("missing");
	}

	const verified = verifyEnterpriseLicense(token, publicKeys);
	if (!verified) {
		return invalidStatus("invalid");
	}

	const nowSeconds = Math.floor(now.getTime() / 1000);
	const { claims, keyId } = verified;
	const expiresAt = new Date(claims.exp * 1000);
	const graceEndsAt = new Date(
		expiresAt.getTime() + ENTERPRISE_LICENSE_GRACE_MS,
	);
	let status: EnterpriseLicenseState;
	if (claims.nbf !== undefined && nowSeconds < claims.nbf) {
		status = "not_yet_valid";
	} else if (nowSeconds < claims.exp) {
		status = "active";
	} else if (now.getTime() < graceEndsAt.getTime()) {
		status = "grace";
	} else {
		status = "expired";
	}

	return {
		status,
		enterpriseEnabled: status === "active" || status === "grace",
		expiresAt: expiresAt.toISOString(),
		graceEndsAt: graceEndsAt.toISOString(),
		maxSeats: claims.maxSeats,
		kind: claims.kind,
		organizationId: claims.organizationId ?? null,
		licenseId: claims.jti,
		keyId,
	};
}

const configuredLicenseToken = process.env.LLMGATEWAY_ENTERPRISE_LICENSE;

export function getEnterpriseLicenseStatus(
	now: Date = new Date(),
): EnterpriseLicenseStatus {
	if (process.env.NODE_ENV !== "production") {
		return invalidStatus("development");
	}
	return evaluateEnterpriseLicense(configuredLicenseToken, now);
}

export function hasDeploymentEnterpriseAccess(now: Date = new Date()): boolean {
	return getEnterpriseLicenseStatus(now).enterpriseEnabled;
}

export function hasWhiteLabelAccessForLicense(
	license: EnterpriseLicenseStatus,
): boolean {
	return (
		license.enterpriseEnabled &&
		(license.status === "development" || license.kind === "white_label")
	);
}

export function hasWhiteLabelAccess(now: Date = new Date()): boolean {
	return hasWhiteLabelAccessForLicense(getEnterpriseLicenseStatus(now));
}

export function hasOrganizationEnterpriseAccessForLicense(
	license: EnterpriseLicenseStatus,
	organizationId: string | null | undefined,
	plan: string | null | undefined,
): boolean {
	return (
		plan === "enterprise" &&
		license.enterpriseEnabled &&
		(license.status === "development" ||
			license.kind === "white_label" ||
			license.organizationId === organizationId)
	);
}

export function hasOrganizationEnterpriseAccess(
	organizationId: string | null | undefined,
	plan: string | null | undefined,
	now: Date = new Date(),
): boolean {
	return hasOrganizationEnterpriseAccessForLicense(
		getEnterpriseLicenseStatus(now),
		organizationId,
		plan,
	);
}

export function effectivePlanWithoutEnterpriseAccess(
	organizationId: string | null | undefined,
	plan: "free" | "pro" | "enterprise" | null | undefined,
	now: Date = new Date(),
): "free" | "pro" | "enterprise" {
	if (
		plan === "enterprise" &&
		!hasOrganizationEnterpriseAccess(organizationId, plan, now)
	) {
		return "free";
	}
	return plan ?? "free";
}
