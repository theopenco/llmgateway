import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import {
	buildProviderEnvInventory,
	collectProviderEnvCredentials,
	countEnvCredentialsByVariant,
	deleteProviderEnvInventory,
	publishProviderEnvInventory,
	readProviderEnvInventory,
} from "./env-inventory.js";

const BASE = "LLM_ALIBABA_API_KEY";
const ENTERPRISE = `${BASE}__ENTERPRISE`;
const PLANS = `${BASE}__PLANS`;
const REGIONAL = `${BASE}__US_VIRGINIA`;

/**
 * A developer .env holds real keys for many providers, which would otherwise
 * turn up in these assertions. Every slot this suite reasons about is stubbed
 * explicitly, blank unless the test sets it.
 */
function clearAlibabaSlots() {
	for (const variant of ["", "__ENTERPRISE", "__PLANS"]) {
		vi.stubEnv(`${BASE}${variant}`, "");
		for (const region of ["SINGAPORE", "US_VIRGINIA", "CN_BEIJING"]) {
			vi.stubEnv(`${BASE}${variant}__${region}`, "");
		}
	}
}

describe("collectProviderEnvCredentials", () => {
	beforeEach(() => {
		clearAlibabaSlots();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns nothing when no variable is set", () => {
		expect(collectProviderEnvCredentials("alibaba")).toEqual([]);
	});

	it("enumerates each key in the comma-separated list by index", () => {
		vi.stubEnv(BASE, "sk-one, sk-two ,, sk-three");

		const entries = collectProviderEnvCredentials("alibaba");
		expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2]);
		expect(entries.every((entry) => entry.envVar === BASE)).toBe(true);
		expect(entries.every((entry) => entry.variant === "default")).toBe(true);
		expect(entries.every((entry) => entry.region === null)).toBe(true);
	});

	it("never carries the plaintext, and fingerprints match request logs", () => {
		vi.stubEnv(BASE, "sk-secret-value");

		const [entry] = collectProviderEnvCredentials("alibaba");
		expect(entry.maskedToken).not.toContain("secret-value");
		expect(JSON.stringify(entry)).not.toContain("sk-secret-value");
		expect(entry.tokenHash).toBe(getApiKeyFingerprint("sk-secret-value"));
	});

	it("covers variant and regional override slots", () => {
		vi.stubEnv(BASE, "sk-base");
		vi.stubEnv(ENTERPRISE, "sk-ent");
		vi.stubEnv(REGIONAL, "sk-regional");

		const entries = collectProviderEnvCredentials("alibaba");
		expect(
			entries.map((entry) => [entry.envVar, entry.variant, entry.region]),
		).toEqual(
			expect.arrayContaining([
				[BASE, "default", null],
				[ENTERPRISE, "enterprise", null],
				[REGIONAL, "default", "us-virginia"],
			]),
		);
	});

	it("treats a service-account JSON as one credential, not comma fragments", () => {
		for (const variant of ["__ENTERPRISE", "__PLANS"]) {
			vi.stubEnv(`LLM_GOOGLE_VERTEX_API_KEY${variant}`, "");
		}
		vi.stubEnv(
			"LLM_GOOGLE_VERTEX_API_KEY",
			'{"type":"service_account","project_id":"p","private_key":"x"}',
		);

		expect(collectProviderEnvCredentials("google-vertex")).toHaveLength(1);
	});

	it("returns nothing for a provider with no API-key env var", () => {
		expect(collectProviderEnvCredentials("not-a-provider")).toEqual([]);
	});
});

describe("countEnvCredentialsByVariant", () => {
	beforeEach(() => {
		clearAlibabaSlots();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("counts each audience's own list and ignores regional slots", () => {
		vi.stubEnv(BASE, "sk-a,sk-b");
		vi.stubEnv(ENTERPRISE, "sk-ent");
		vi.stubEnv(REGIONAL, "sk-regional");

		expect(
			countEnvCredentialsByVariant(collectProviderEnvCredentials("alibaba")),
		).toEqual({ default: 2, enterprise: 1, plans: 0 });
	});

	it("reports zero for an unset variant rather than the default it falls back to", () => {
		vi.stubEnv(BASE, "sk-a");
		vi.stubEnv(PLANS, "");

		expect(
			countEnvCredentialsByVariant(collectProviderEnvCredentials("alibaba"))
				.plans,
		).toBe(0);
	});
});

describe("provider env inventory snapshot", () => {
	beforeEach(async () => {
		clearAlibabaSlots();
		await deleteProviderEnvInventory();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteProviderEnvInventory();
	});

	it("reads back what was published", async () => {
		vi.stubEnv(BASE, "sk-published");
		await publishProviderEnvInventory();

		const inventory = await readProviderEnvInventory();
		expect(inventory?.version).toBe(1);
		expect(inventory?.providers.alibaba).toEqual([
			{
				envVar: BASE,
				variant: "default",
				region: null,
				index: 0,
				maskedToken: expect.any(String),
				tokenHash: getApiKeyFingerprint("sk-published"),
			},
		]);
	});

	it("carries no plaintext into Redis", async () => {
		vi.stubEnv(BASE, "sk-never-stored");
		await publishProviderEnvInventory();

		const inventory = await readProviderEnvInventory();
		expect(JSON.stringify(inventory)).not.toContain("sk-never-stored");
	});

	it("omits providers with no keys, and custom entirely", () => {
		vi.stubEnv(BASE, "sk-a");

		const inventory = buildProviderEnvInventory();
		expect(inventory.providers.alibaba).toHaveLength(1);
		expect(inventory.providers.custom).toBeUndefined();
		expect(
			Object.values(inventory.providers).every((entries) => entries.length > 0),
		).toBe(true);
	});

	it("returns null when nothing has been published", async () => {
		expect(await readProviderEnvInventory()).toBeNull();
	});
});
