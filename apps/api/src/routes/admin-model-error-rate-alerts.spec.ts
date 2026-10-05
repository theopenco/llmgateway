import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { getModelErrorRateAlertsSettings } from "@/lib/model-error-rate-alerts.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { DEFAULT_MODEL_ERROR_RATE_ALERT_RULES } from "@llmgateway/shared";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const path = "/admin/settings/model-error-rate-alerts";

describe("admin model error-rate alert settings", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	test("defaults to off with the 15m and 4h rules", async () => {
		const res = await app.request(path, { headers: { Cookie: cookie } });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			enabled: false,
			rules: DEFAULT_MODEL_ERROR_RATE_ALERT_RULES,
		});
	});

	test("requires authentication", async () => {
		const res = await app.request(path);
		expect(res.status).toBe(401);
	});

	test("stores the switch and edited rules", async () => {
		const rules = [
			{ ...DEFAULT_MODEL_ERROR_RATE_ALERT_RULES[0], errorRatePercent: 50 },
		];
		const res = await app.request(path, {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: true, rules }),
		});

		expect(res.status).toBe(200);
		expect(await getModelErrorRateAlertsSettings()).toEqual({
			enabled: true,
			rules,
		});
	});

	test("rejects duplicate ids and out-of-range values", async () => {
		const rule = DEFAULT_MODEL_ERROR_RATE_ALERT_RULES[0];
		const duplicate = await app.request(path, {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: true, rules: [rule, rule] }),
		});
		expect(duplicate.status).toBe(400);

		const range = await app.request(path, {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				rules: [{ ...rule, errorRatePercent: 101 }],
			}),
		});
		expect(range.status).toBe(400);

		expect((await getModelErrorRateAlertsSettings()).enabled).toBe(false);
	});
});
