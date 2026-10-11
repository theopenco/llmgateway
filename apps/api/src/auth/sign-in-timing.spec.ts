import { hashPassword } from "better-auth/crypto";
import { describe, expect, test } from "vitest";

import {
	delayLikePasswordHash,
	timedVerifyPassword,
} from "./sign-in-timing.js";

describe("sign-in timing", () => {
	test("delays for as long as a real password check took", async () => {
		const hash = await hashPassword("Password123!");

		const verifyStart = performance.now();
		expect(await timedVerifyPassword({ hash, password: "wrong" })).toBe(false);
		const verifyMs = performance.now() - verifyStart;
		expect(verifyMs).toBeGreaterThan(1);

		const delayStart = performance.now();
		await delayLikePasswordHash();
		const delayMs = performance.now() - delayStart;

		// setTimeout truncates to whole ms and never fires early; the bounds
		// leave room for scheduling noise on a loaded machine.
		const schedulingSlackMs = 50;
		expect(delayMs).toBeGreaterThanOrEqual(verifyMs * 0.5);
		expect(delayMs - schedulingSlackMs).toBeLessThan(verifyMs * 5);
	});

	test("still verifies a correct password", async () => {
		const hash = await hashPassword("Password123!");
		expect(await timedVerifyPassword({ hash, password: "Password123!" })).toBe(
			true,
		);
	});
});
