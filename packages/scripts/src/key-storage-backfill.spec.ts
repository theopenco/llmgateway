import { afterEach, describe, expect, it } from "vitest";

import {
	describeDatabaseTarget,
	isRetrievableApiKeyType,
	parseKeyStorageBackfillOptions,
	RETRIEVABLE_API_KEY_TYPES,
	requireExplicitHashSecret,
} from "./key-storage-backfill.js";

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_HASH_SECRET = process.env.GATEWAY_API_KEY_HASH_SECRET;

function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	process.argv = [...ORIGINAL_ARGV];
	setEnv("DATABASE_URL", ORIGINAL_DATABASE_URL);
	setEnv("GATEWAY_API_KEY_HASH_SECRET", ORIGINAL_HASH_SECRET);
});

describe("parseKeyStorageBackfillOptions", () => {
	it("defaults to a dry run with batches of 100", () => {
		process.argv = ["node", "backfill"];

		expect(parseKeyStorageBackfillOptions()).toEqual({
			batchSize: 100,
			commit: false,
		});
	});

	it("accepts commit mode and a custom batch size", () => {
		process.argv = ["node", "backfill", "--commit", "--batch-size=250"];

		expect(parseKeyStorageBackfillOptions()).toEqual({
			batchSize: 250,
			commit: true,
		});
	});

	it.each(["--batch-size=0", "--batch-size=1001", "--batch-size=nope"])(
		"rejects invalid batch size %s",
		(argument) => {
			process.argv = ["node", "backfill", argument];

			expect(() => parseKeyStorageBackfillOptions()).toThrow(
				/--batch-size must be an integer between 1 and 1000/,
			);
		},
	);

	it("rejects unknown arguments", () => {
		process.argv = ["node", "backfill", "--force"];

		expect(() => parseKeyStorageBackfillOptions()).toThrow(
			"Unknown argument(s): --force",
		);
	});
});

describe("requireExplicitHashSecret", () => {
	it("rejects commit mode without an explicit secret", () => {
		setEnv("GATEWAY_API_KEY_HASH_SECRET", undefined);

		expect(() => requireExplicitHashSecret()).toThrow(
			/GATEWAY_API_KEY_HASH_SECRET must be explicitly set/,
		);
	});

	it("accepts an explicit keyring", () => {
		setEnv("GATEWAY_API_KEY_HASH_SECRET", "current-secret,old-secret");

		expect(() => requireExplicitHashSecret()).not.toThrow();
	});
});

describe("API key type policy", () => {
	it("backfills every secret-bearing API key kind", () => {
		const keyTypes = [
			"user",
			"platform_secret",
			"platform_publishable",
			"end_user_customer",
		] as const;

		expect(
			keyTypes.filter((keyType) => !isRetrievableApiKeyType(keyType)),
		).toEqual(["user", "platform_secret", "end_user_customer"]);
		expect(RETRIEVABLE_API_KEY_TYPES).toEqual(["platform_publishable"]);
		expect(
			RETRIEVABLE_API_KEY_TYPES.every(isRetrievableApiKeyType),
		).toBe(true);
	});
});

describe("describeDatabaseTarget", () => {
	it("reports the database without exposing credentials", () => {
		setEnv(
			"DATABASE_URL",
			"postgres://operator:sensitive@db.example:5432/llmgateway?sslmode=require",
		);

		const target = describeDatabaseTarget();

		expect(target).toBe("db.example:5432/llmgateway");
		expect(target).not.toContain("operator");
		expect(target).not.toContain("sensitive");
	});
});
