import { afterEach, describe, expect, test } from "vitest";

import { redactCredentials } from "./redact-credentials.js";

const added: string[] = [];

function setEnv(name: string, value: string): void {
	added.push(name);
	process.env[name] = value;
}

afterEach(() => {
	for (const name of added.splice(0)) {
		delete process.env[name];
	}
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
