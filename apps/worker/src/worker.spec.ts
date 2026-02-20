import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";

import { acquireLock } from "./worker.js";

describe("worker", () => {
	beforeEach(async () => {
		// Clean up lock table before each test
		await db.delete(tables.lock);
	});

	afterAll(async () => {
		// Clean up after all tests
		await db.delete(tables.lock);
	});

	describe("acquireLock", () => {
		test("should return true when acquiring a new lock", async () => {
			const lockKey = "test-lock-1";
			const result = await acquireLock(lockKey);

			expect(result).toBe(true);

			// Verify the lock was created in the database
			const locks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(locks).toHaveLength(1);
			expect(locks[0].key).toBe(lockKey);
		});

		test("should return false when acquiring a duplicate lock", async () => {
			const lockKey = "test-lock-2";

			// First acquisition should succeed
			const firstResult = await acquireLock(lockKey);
			expect(firstResult).toBe(true);

			// Second acquisition should fail due to duplicate key
			const secondResult = await acquireLock(lockKey);
			expect(secondResult).toBe(false);

			// Verify only one lock exists in the database
			const locks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(locks).toHaveLength(1);
		});

		test("should clean up expired locks and allow re-acquisition", async () => {
			const lockKey = "test-lock-3";

			// Create an expired lock by directly inserting into database
			// Set updatedAt to 15 minutes ago (longer than LOCK_DURATION_MINUTES = 10)
			// eslint-disable-next-line no-mixed-operators
			const expiredTime = new Date(Date.now() - 15 * 60 * 1000);
			await db.insert(tables.lock).values({
				key: lockKey,
				updatedAt: expiredTime,
				createdAt: expiredTime,
			});

			// Verify the expired lock exists
			const expiredLocks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(expiredLocks).toHaveLength(1);

			// Acquiring the lock should succeed (cleanup expired and create new)
			const result = await acquireLock(lockKey);
			expect(result).toBe(true);

			// Verify the lock was cleaned up and re-created
			const newLocks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(newLocks).toHaveLength(1);
			// The new lock should have a recent updatedAt time
			const timeDiff = Date.now() - newLocks[0].updatedAt.getTime();
			expect(timeDiff).toBeLessThan(5000); // Less than 5 seconds old
		});

		test("should handle multiple different locks simultaneously", async () => {
			const lockKey1 = "test-lock-4a";
			const lockKey2 = "test-lock-4b";

			// Both should succeed as they are different keys
			const result1 = await acquireLock(lockKey1);
			const result2 = await acquireLock(lockKey2);

			expect(result1).toBe(true);
			expect(result2).toBe(true);

			// Verify both locks exist
			const locks = await db.query.lock.findMany();
			expect(locks).toHaveLength(2);

			const lockKeys = locks.map((lock) => lock.key).sort();
			expect(lockKeys).toEqual([lockKey1, lockKey2].sort());
		});
	});
});
