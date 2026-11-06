import { afterEach, expect, it, vi } from "vitest";

import {
	proCheckoutContextHash,
	proCheckoutIdempotencyKey,
} from "@/lib/pro-checkout-key.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

const parts = [
	3,
	0,
	0,
	false,
	false,
	"price_seat",
	"price_extra_key",
	"price_extra_project",
	"price_sso",
	"price_scim",
] as const;

it("keeps retries stable without exposing confidential checkout context", () => {
	vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "synthetic-checkout-test-secret");
	const context = JSON.stringify({
		organizationId: "test-organization",
		email: "admin@example.com",
		returnUrl: "http://localhost/return",
		threeDSecure: "automatic",
	});
	const key = proCheckoutIdempotencyKey(context, "initial", parts);
	expect(proCheckoutIdempotencyKey(context, "initial", parts)).toBe(key);
	expect(key).not.toContain("test-organization");
	expect(key).not.toContain("admin@example.com");
	expect(key).not.toContain("synthetic-checkout-test-secret");
	expect(key).toContain("price_extra_key");
	expect(Buffer.byteLength(key)).toBeLessThanOrEqual(255);
	expect(proCheckoutIdempotencyKey(context, "expired-session", parts)).not.toBe(
		key,
	);
	expect(
		proCheckoutIdempotencyKey(context, "initial", [4, ...parts.slice(1)]),
	).not.toBe(key);
	expect(
		proCheckoutIdempotencyKey(`${context}-changed`, "initial", parts),
	).not.toBe(key);
	expect(
		proCheckoutIdempotencyKey(context, "initial", [
			...parts.slice(0, -1),
			"price_scim_changed",
		]),
	).not.toBe(key);
	vi.stubEnv(
		"GATEWAY_API_KEY_HASH_SECRET",
		"different-synthetic-checkout-test-secret",
	);
	expect(proCheckoutContextHash(context)).not.toBe(
		proCheckoutContextHash(`${context}-changed`),
	);
	expect(proCheckoutIdempotencyKey(context, "initial", parts)).not.toBe(key);
});

it("rejects unbounded or non-public suffixes", () => {
	for (const part of [
		-1,
		501,
		1.5,
		"not-a-price",
		`price_${"a".repeat(256)}`,
	]) {
		expect(() =>
			proCheckoutIdempotencyKey("test-context", "initial", [part]),
		).toThrow();
	}
});
