import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

import {
	collectCredentialValues,
	isCredentialEnvName,
	redactCredentials,
} from "./redact-credentials.js";

const added: string[] = [];

function setEnv(name: string, value: string): void {
	added.push(name);
	process.env[name] = value;
}

afterEach(() => {
	for (const name of added.splice(0)) {
		Reflect.deleteProperty(process.env, name);
	}
});

describe("isCredentialEnvName", () => {
	test("treats the LLM_ namespace as secret by default", () => {
		// Neither name contains API_KEY, TOKEN or SECRET.
		expect(isCredentialEnvName("LLM_RUNPOD_KEY")).toBe(true);
		expect(isCredentialEnvName("LLM_SOMETHING_NEW")).toBe(true);
	});

	test("exempts the catalogue's non-secret knobs", () => {
		for (const name of [
			"LLM_OPENAI_BASE_URL",
			"LLM_AWS_BEDROCK_REGION",
			"LLM_GOOGLE_CLOUD_PROJECT",
			"LLM_AZURE_RESOURCE",
			"LLM_AZURE_API_VERSION",
			"LLM_ALIBABA_WORKSPACE_ID",
			"LLM_GOOGLE_VERTEX_TOKEN_TYPE",
		]) {
			expect(isCredentialEnvName(name)).toBe(false);
		}
	});

	test("resolves variant and regional overrides to their base variable", () => {
		expect(isCredentialEnvName("LLM_ALIBABA_API_KEY__EU_FRANKFURT")).toBe(true);
		expect(isCredentialEnvName("LLM_OPENAI_BASE_URL__ENTERPRISE")).toBe(false);
	});

	test("falls back to name patterns outside the LLM_ namespace", () => {
		expect(isCredentialEnvName("GITHUB_TOKEN")).toBe(true);
		expect(isCredentialEnvName("TEST_MODELS")).toBe(false);
	});
});

describe("redactCredentials", () => {
	test("redacts a credential value", () => {
		setEnv("LLM_TEST_REDACT_API_KEY", "sk-plaintext-credential-value");

		expect(
			redactCredentials("upstream said: sk-plaintext-credential-value is bad"),
		).toBe("upstream said: [REDACTED] is bad");
	});

	test("redacts a single entry of a comma-separated list", () => {
		setEnv(
			"LLM_TEST_REDACT_LIST_API_KEY",
			"sk-first-credential-value,sk-second-credential-value",
		);

		expect(redactCredentials("used sk-second-credential-value")).toBe(
			"used [REDACTED]",
		);
	});

	test("redacts a service-account private key in both newline forms", () => {
		const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n";
		setEnv(
			"LLM_TEST_REDACT_SERVICE_ACCOUNT_JSON",
			JSON.stringify({
				client_email: "sa@example.com",
				private_key: privateKey,
				token_uri: "https://oauth2.example.com/token",
			}),
		);

		expect(redactCredentials(privateKey).includes("MIIEvQIBADANBg")).toBe(
			false,
		);
		expect(
			redactCredentials(JSON.stringify({ private_key: privateKey })).includes(
				"MIIEvQIBADANBg",
			),
		).toBe(false);
	});

	test("leaves seeded fixtures and non-credential variables alone", () => {
		setEnv("LLM_TEST_REDACT_SHORT_API_KEY", "test-token");
		setEnv("LLM_TEST_REDACT_REGION", "us-east-1-not-a-secret");

		expect(redactCredentials("test-token us-east-1-not-a-secret")).toBe(
			"test-token us-east-1-not-a-secret",
		);
	});
});

describe("mask-ci-credentials.mjs", () => {
	/** The script is a standalone copy so it can run before anything is built;
	 * this is what stops the two from drifting apart. */
	test("masks exactly the values this module redacts", () => {
		const fixture: Record<string, string> = {
			PATH: process.env.PATH ?? "",
			LLM_PARITY_API_KEY: "sk-parity-first-value,sk-parity-second-value",
			LLM_PARITY_KEY: "rp-parity-credential-value",
			LLM_PARITY_BASE_URL: "https://parity.example.com/v1",
			LLM_PARITY_SERVICE_ACCOUNT_JSON: JSON.stringify({
				client_email: "sa@example.com",
				private_key: "-----BEGIN PRIVATE KEY-----\nPARITYLINEONE\n",
			}),
		};

		const realEnv = process.env;
		process.env = { ...fixture };
		const expected = collectCredentialValues().filter(
			(value) => !/[\r\n]/.test(value),
		);
		process.env = realEnv;

		const stdout = execFileSync(
			process.execPath,
			["scripts/mask-ci-credentials.mjs"],
			{ env: fixture, encoding: "utf8" },
		);
		const masks = stdout
			.split("\n")
			.filter((line) => line.startsWith("::add-mask::"))
			.map((line) => line.slice("::add-mask::".length));

		expect(masks.length).toBeGreaterThan(0);
		expect(new Set(masks)).toEqual(new Set(expected));
		// A multi-line mask would make the runner echo everything after line one.
		expect(masks.every((mask) => !mask.includes("\n"))).toBe(true);
	});
});
