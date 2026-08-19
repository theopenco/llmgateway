import { describe, expect, it } from "vitest";

import { detectSecrets, redactSecrets, secretsRule } from "./secrets.js";

const clean = [
	"commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3 reverted",
	"integrity sha1-2jmj7l5rSw0yVb0000000000000000000000000000",
	"set apiKey: YOUR_API_KEY_HERE_PLACEHOLDER",
	"api_key=${OPENAI_API_KEY}",
	"apiKey: process.env.OPENAI_API_KEY_VALUE_HERE",
	'{"password": "********"}',
	"password: <your-password>",
	"passwd: xxxxxxxxxxxx",
	"the user forgot their password, please reset it",
	"postgres://user:${DB_PASSWORD}@db.internal:5432/app",
	"see the eyJ header docs for details",
];

// Assembled at runtime so the fixtures do not trip secret scanners.
const stripeKey = ["sk", "live", "51H8xQ2eZvKYlo2CabcdefghijK"].join("_");

const detected = [
	["AWS Access Key", "AKIAIOSFODNN7EXAMPLE"],
	[
		"AWS Secret Key",
		"aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12",
	],
	["Stripe Key", stripeKey],
	["GitHub Token", "ghp_" + "a".repeat(36)],
	["Private Key", "-----BEGIN RSA PRIVATE KEY-----"],
	["Connection String", "postgres://admin:s3cretPassw0rd@db.internal:5432/app"],
	["Password", '{"password": "hunter2000!"}'],
	["Password", "password=Tr0ub4dor&3xxx"],
	["API Key", "api_key: sk9Xk2Lm4Qp7Rt1Zv8Bn3Cw6"],
	// A single angle bracket must not read as a template placeholder.
	["Password", "password=p<ssw0rd!"],
	// Prefix-matching a placeholder word used to discard the whole value.
	["Password", "password=testingSecret123"],
] as const;

describe("detectSecrets", () => {
	it.each(clean)("does not flag %j", (content) => {
		expect(detectSecrets(content).patterns).toEqual([]);
	});

	it.each(detected)("flags %s in %j", (label, content) => {
		expect(detectSecrets(content).patterns).toContain(label);
	});
});

describe("redactSecrets", () => {
	it("leaves a git sha untouched", () => {
		const content = "commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3";
		expect(redactSecrets(content).redacted).toBe(content);
	});

	it("redacts a detected credential", () => {
		expect(redactSecrets("use AKIAIOSFODNN7EXAMPLE for uploads").redacted).toBe(
			"use [SECRET_REDACTED] for uploads",
		);
	});

	it("reports specific labels instead of a generic one", () => {
		expect(detectSecrets("AKIAIOSFODNN7EXAMPLE").patterns).toEqual([
			"AWS Access Key",
		]);
	});

	it("keeps JSON valid by redacting only the value", () => {
		expect(redactSecrets('{"password":"hunter2000!"}').redacted).toBe(
			'{"password":"[SECRET_REDACTED]"}',
		);
	});

	it("redacts a quoted value containing a comma in full", () => {
		expect(redactSecrets('password: "hunter,2000!"').redacted).toBe(
			'password: "[SECRET_REDACTED]"',
		);
	});

	it("redacts an unquoted value without touching the key", () => {
		expect(redactSecrets("password=Tr0ub4dor3xyz").redacted).toBe(
			"password=[SECRET_REDACTED]",
		);
	});
});

describe("secretsRule.check", () => {
	it("reports detector labels, never fragments of the secret", () => {
		const result = secretsRule.check("key AKIAIOSFODNN7EXAMPLE leaked", {
			enabled: true,
			action: "block",
		});

		expect(result.passed).toBe(false);
		expect(result.matches).toEqual(["AWS Access Key"]);
		expect(result.matches.join(" ")).not.toContain("AKIA");
	});
});
