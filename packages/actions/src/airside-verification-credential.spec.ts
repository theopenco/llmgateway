import { describe, expect, it, afterEach, vi } from "vitest";

import {
	providerVerificationCredentialFingerprint,
	environmentVerificationCredentialFingerprint,
} from "./airside-verification-credential.js";
import { buildVerificationTarget } from "./model-verification-target.js";

const key: Parameters<typeof providerVerificationCredentialFingerprint>[0] = {
	id: "verification-key",
	provider: "verification-carrier",
	tokenCiphertext: "encrypted-fixture",
	config: null,
	region: null,
	variant: "default",
	allowedModels: null,
	options: null,
	baseUrl: null,
};

describe("verification credential proof", () => {
	it("binds proof to the exact provider key and its deployment configuration", () => {
		const fingerprint = providerVerificationCredentialFingerprint(key);
		expect(providerVerificationCredentialFingerprint({ ...key })).toBe(
			fingerprint,
		);
		for (const changed of [
			{ ...key, id: "replacement-key" },
			{ ...key, provider: "other-carrier" },
			{ ...key, tokenCiphertext: "rotated-ciphertext" },
			{ ...key, region: "eu" },
			{ ...key, baseUrl: "https://other.example" },
			{ ...key, variant: "enterprise" as const },
			{ ...key, allowedModels: ["other-model"] },
			{ ...key, options: { aws_bedrock_region_prefix: "eu." as const } },
		]) {
			expect(
				providerVerificationCredentialFingerprint(changed) === fingerprint,
			).toBe(false);
		}
		expect(
			providerVerificationCredentialFingerprint(
				key,
				"https://carrier.example",
			) === fingerprint,
		).toBe(false);
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
});

it("binds environment proof to credential and endpoint configuration without caching", () => {
	const target = buildVerificationTarget({
		providerId: "openai",
		modelName: "environment-verification",
	});
	vi.stubEnv("LLM_OPENAI_API_KEY", "fixture-environment-key");
	vi.stubEnv("LLM_OPENAI_BASE_URL", "https://first.example");
	const fingerprint = environmentVerificationCredentialFingerprint(target);
	expect(
		environmentVerificationCredentialFingerprint(target) === fingerprint,
	).toBe(true);
	vi.stubEnv("LLM_OPENAI_API_KEY", "rotated-fixture-environment-key");
	expect(
		environmentVerificationCredentialFingerprint(target) === fingerprint,
	).toBe(false);
	vi.stubEnv("LLM_OPENAI_API_KEY", "fixture-environment-key");
	vi.stubEnv("LLM_OPENAI_BASE_URL", "https://second.example");
	expect(
		environmentVerificationCredentialFingerprint(target) === fingerprint,
	).toBe(false);
});
