import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import {
	FORCE_3DS_SETTING_ID,
	getForcedThreeDSecure,
	getForcedThreeDSecureMode,
	parseThreeDSecureRequest,
	setForcedThreeDSecureMode,
	threeDSecureOptions,
	threeDSecureSubscriptionSettings,
} from "./three-d-secure.js";

describe("parseThreeDSecureRequest", () => {
	it("accepts the two requestable levels, case-insensitively", () => {
		expect(parseThreeDSecureRequest("any")).toBe("any");
		expect(parseThreeDSecureRequest(" Challenge ")).toBe("challenge");
	});

	it("treats `true` as a challenge request", () => {
		expect(parseThreeDSecureRequest("true")).toBe("challenge");
	});

	it("ignores values Stripe would reject rather than passing them through", () => {
		expect(parseThreeDSecureRequest("yes")).toBeUndefined();
		expect(parseThreeDSecureRequest(null)).toBeUndefined();
		// `automatic` is Stripe's default; sending it explicitly buys nothing.
		expect(parseThreeDSecureRequest("automatic")).toBeUndefined();
	});
});

describe("parameter shapes", () => {
	it("spread to nothing when 3DS is not forced", () => {
		expect(threeDSecureOptions(undefined)).toEqual({});
		expect(threeDSecureSubscriptionSettings(undefined)).toEqual({});
	});

	it("nest the request where each Stripe resource expects it", () => {
		expect(threeDSecureOptions("any")).toEqual({
			payment_method_options: { card: { request_three_d_secure: "any" } },
		});
		expect(threeDSecureSubscriptionSettings("challenge")).toEqual({
			payment_settings: {
				payment_method_options: {
					card: { request_three_d_secure: "challenge" },
				},
			},
		});
	});
});

describe("admin setting", () => {
	beforeEach(async () => {
		vi.stubEnv("STRIPE_FORCE_3DS", undefined);
		await db.delete(tables.systemSetting);
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	it("is off until an admin turns it on", async () => {
		expect(await getForcedThreeDSecureMode()).toBe("off");
		expect(await getForcedThreeDSecure()).toBeUndefined();
	});

	it("round-trips the level an admin selects", async () => {
		await setForcedThreeDSecureMode("challenge");

		expect(await getForcedThreeDSecureMode()).toBe("challenge");
		expect(await getForcedThreeDSecure()).toBe("challenge");
	});

	it("turns back off without leaving the old level active", async () => {
		await setForcedThreeDSecureMode("any");
		await setForcedThreeDSecureMode("off");

		const row = await db.query.systemSetting.findFirst({
			where: { id: FORCE_3DS_SETTING_ID },
		});
		expect(row?.enabled).toBe(false);
		expect(await getForcedThreeDSecureMode()).toBe("off");
		expect(await getForcedThreeDSecure()).toBeUndefined();
	});

	it("lets STRIPE_FORCE_3DS override the stored setting", async () => {
		await setForcedThreeDSecureMode("any");
		vi.stubEnv("STRIPE_FORCE_3DS", "challenge");

		expect(await getForcedThreeDSecure()).toBe("challenge");
		// The stored setting is untouched — the override is not persisted.
		expect(await getForcedThreeDSecureMode()).toBe("any");
	});

	it("applies the env override even when the admin setting is off", async () => {
		vi.stubEnv("STRIPE_FORCE_3DS", "any");

		expect(await getForcedThreeDSecureMode()).toBe("off");
		expect(await getForcedThreeDSecure()).toBe("any");
	});
});
