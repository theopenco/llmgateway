import { describe, expect, it } from "vitest";

import {
	clampClientSecretTtl,
	clientSecretRedisKey,
	DEFAULT_CLIENT_SECRET_TTL_SECONDS,
	generateClientSecretValue,
	MAX_CLIENT_SECRET_TTL_SECONDS,
	MIN_CLIENT_SECRET_TTL_SECONDS,
	parseClientSecretRecord,
} from "./client-secrets.js";

describe("generateClientSecretValue", () => {
	it("uses the ek_ prefix with 32 bytes of base64url entropy", () => {
		const value = generateClientSecretValue();
		expect(value.startsWith("ek_")).toBe(true);
		const payload = value.slice(3);
		// 32 bytes base64url-encoded is 43 characters, unpadded.
		expect(payload).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("generates unique values", () => {
		const values = new Set(
			Array.from({ length: 100 }, () => generateClientSecretValue()),
		);
		expect(values.size).toBe(100);
	});
});

describe("clientSecretRedisKey", () => {
	it("fingerprints the secret so the raw value is absent from the key", () => {
		const secret = generateClientSecretValue();
		const key = clientSecretRedisKey(secret);
		expect(key.startsWith("realtime:client-secrets:")).toBe(true);
		expect(key).not.toContain(secret);
		expect(key).toMatch(/^realtime:client-secrets:[0-9a-f]{64}$/);
	});

	it("is deterministic per secret", () => {
		const secret = generateClientSecretValue();
		expect(clientSecretRedisKey(secret)).toBe(clientSecretRedisKey(secret));
		expect(clientSecretRedisKey(secret)).not.toBe(
			clientSecretRedisKey(generateClientSecretValue()),
		);
	});
});

describe("clampClientSecretTtl", () => {
	it("defaults when unset or malformed", () => {
		expect(clampClientSecretTtl(undefined)).toBe(
			DEFAULT_CLIENT_SECRET_TTL_SECONDS,
		);
		expect(clampClientSecretTtl(null)).toBe(DEFAULT_CLIENT_SECRET_TTL_SECONDS);
		expect(clampClientSecretTtl("60")).toBe(DEFAULT_CLIENT_SECRET_TTL_SECONDS);
		expect(clampClientSecretTtl(Number.NaN)).toBe(
			DEFAULT_CLIENT_SECRET_TTL_SECONDS,
		);
		expect(clampClientSecretTtl(Number.POSITIVE_INFINITY)).toBe(
			DEFAULT_CLIENT_SECRET_TTL_SECONDS,
		);
	});

	it("clamps to the allowed range", () => {
		expect(clampClientSecretTtl(1)).toBe(MIN_CLIENT_SECRET_TTL_SECONDS);
		expect(clampClientSecretTtl(100000)).toBe(MAX_CLIENT_SECRET_TTL_SECONDS);
		expect(clampClientSecretTtl(120)).toBe(120);
		expect(clampClientSecretTtl(59.9)).toBe(59);
	});
});

describe("parseClientSecretRecord", () => {
	const valid = {
		v: 1,
		token: "llmgtwy_test",
		model: "openai/gpt-realtime-2.1-mini",
		transcriptionModel: "gpt-4o-mini-transcribe",
		source: "lounge.llmgateway.io",
		createdAt: 1_784_800_000,
		expiresAt: 1_784_800_060,
	};

	it("accepts a valid record", () => {
		expect(parseClientSecretRecord(JSON.stringify(valid))).toEqual(valid);
	});

	it("accepts null transcriptionModel and source", () => {
		const record = { ...valid, transcriptionModel: null, source: null };
		expect(parseClientSecretRecord(JSON.stringify(record))).toEqual(record);
	});

	it("rejects malformed JSON", () => {
		expect(parseClientSecretRecord("{not json")).toBeNull();
	});

	it("rejects non-object payloads", () => {
		expect(parseClientSecretRecord("null")).toBeNull();
		expect(parseClientSecretRecord("[]")).toBeNull();
		expect(parseClientSecretRecord('"ek_abc"')).toBeNull();
	});

	it("rejects unknown versions", () => {
		expect(parseClientSecretRecord(JSON.stringify({ ...valid, v: 2 }))).toBe(
			null,
		);
	});

	it("rejects missing or empty required fields", () => {
		expect(
			parseClientSecretRecord(JSON.stringify({ ...valid, token: "" })),
		).toBeNull();
		expect(
			parseClientSecretRecord(JSON.stringify({ ...valid, model: undefined })),
		).toBeNull();
		expect(
			parseClientSecretRecord(JSON.stringify({ ...valid, expiresAt: "soon" })),
		).toBeNull();
		expect(
			parseClientSecretRecord(
				JSON.stringify({ ...valid, transcriptionModel: 42 }),
			),
		).toBeNull();
		expect(
			parseClientSecretRecord(JSON.stringify({ ...valid, source: 42 })),
		).toBeNull();
	});
});
