import { randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import {
	ENTERPRISE_LICENSE_AUDIENCE,
	ENTERPRISE_LICENSE_ISSUER,
} from "../../packages/shared/src/enterprise-license.js";

interface Arguments {
	customerId: string;
	kind: "enterprise" | "white_label";
	organizationId?: string;
	maxSeats: number;
	expiresAt: Date;
	notBefore?: Date;
	keyId: string;
	privateKeyFile: string;
}

function requiredValue(args: string[], flag: string): string {
	const index = args.indexOf(flag);
	const value = index >= 0 ? args[index + 1] : undefined;
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} is required`);
	}
	return value;
}

function optionalValue(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index < 0) {
		return undefined;
	}
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function parseDate(value: string, flag: string): Date {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`${flag} must be a valid ISO-8601 timestamp`);
	}
	return date;
}

function parseArguments(args: string[]): Arguments {
	const maxSeats = Number(requiredValue(args, "--max-seats"));
	if (!Number.isInteger(maxSeats) || maxSeats <= 0) {
		throw new Error("--max-seats must be a positive integer");
	}

	const notBefore = optionalValue(args, "--not-before");
	const rawKind = requiredValue(args, "--kind");
	if (rawKind !== "enterprise" && rawKind !== "white-label") {
		throw new Error("--kind must be enterprise or white-label");
	}
	const organizationId = optionalValue(args, "--organization-id");
	if (rawKind === "enterprise" && !organizationId) {
		throw new Error("--organization-id is required for enterprise licenses");
	}
	if (rawKind === "white-label" && organizationId) {
		throw new Error("--organization-id is not valid for white-label licenses");
	}
	return {
		customerId: requiredValue(args, "--customer-id"),
		kind: rawKind === "white-label" ? "white_label" : "enterprise",
		...(organizationId ? { organizationId } : {}),
		maxSeats,
		expiresAt: parseDate(requiredValue(args, "--expires-at"), "--expires-at"),
		...(notBefore
			? { notBefore: parseDate(notBefore, "--not-before") }
			: {}),
		keyId: optionalValue(args, "--key-id") ?? "2026-08-01",
		privateKeyFile: requiredValue(args, "--private-key-file"),
	};
}

function encodeJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function main(): void {
	const args = parseArguments(process.argv.slice(2));
	const issuedAt = Math.floor(Date.now() / 1000);
	const expiresAt = Math.floor(args.expiresAt.getTime() / 1000);
	const notBefore = args.notBefore
		? Math.floor(args.notBefore.getTime() / 1000)
		: undefined;
	if (expiresAt <= issuedAt || (notBefore !== undefined && notBefore > expiresAt)) {
		throw new Error("The license validity window is invalid");
	}

	const encodedHeader = encodeJson({
		alg: "EdDSA",
		typ: "JWT",
		kid: args.keyId,
	});
	const encodedPayload = encodeJson({
		iss: ENTERPRISE_LICENSE_ISSUER,
		aud: ENTERPRISE_LICENSE_AUDIENCE,
		ver: 1,
		kind: args.kind,
		jti: randomUUID(),
		sub: args.customerId,
		...(args.organizationId ? { organizationId: args.organizationId } : {}),
		iat: issuedAt,
		...(notBefore === undefined ? {} : { nbf: notBefore }),
		exp: expiresAt,
		entitlements:
			args.kind === "white_label"
				? ["enterprise", "white_label"]
				: ["enterprise"],
		maxSeats: args.maxSeats,
	});
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const privateKey = readFileSync(args.privateKeyFile);
	const signature = sign(null, Buffer.from(signingInput), privateKey);
	process.stdout.write(`${signingInput}.${signature.toString("base64url")}\n`);
}

try {
	main();
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
