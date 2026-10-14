import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import {
	DEFAULT_PROVIDER_KEY_ALERT_RULES,
	DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
} from "@llmgateway/shared/provider-key-alerts";

const organizationId = "provider-key-alerts-org";

describe("provider key alerts", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: organizationId,
			name: "Provider Key Alerts Test",
			billingEmail: "billing@example.com",
		});
		await db.insert(tables.userOrganization).values({
			organizationId,
			userId: "test-user-id",
			role: "owner",
		});
	});
	afterEach(async () => {
		await deleteAll();
	});

	function request(method = "GET", body?: unknown) {
		return app.request(`/orgs/${organizationId}/provider-key-alerts`, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	test("returns the defaults until configured", async () => {
		const res = await request();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			settings: DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
			configured: false,
		});
	});

	test("saves settings and audits the change", async () => {
		const settings = {
			...DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
			enabled: true,
			rules: [{ ...DEFAULT_PROVIDER_KEY_ALERT_RULES[0], errorRatePercent: 40 }],
		};
		const res = await request("PUT", settings);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ settings, configured: true });
		const org = await db.query.organization.findFirst({
			where: { id: organizationId },
		});
		expect(org?.providerKeyAlertSettings).toEqual(settings);
		const audit = await db.query.auditLog.findFirst({
			where: { organizationId, action: "provider_key_alert.settings_update" },
		});
		expect(audit).toBeTruthy();
	});

	test("rejects unconfigured channels and rule-less enablement", async () => {
		const withSlack = await request("PUT", {
			...DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
			channels: ["slack"],
		});
		expect(withSlack.status).toBe(400);
		const noRules = await request("PUT", {
			...DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
			enabled: true,
			rules: [{ ...DEFAULT_PROVIDER_KEY_ALERT_RULES[0], enabled: false }],
		});
		expect(noRules.status).toBe(400);
		const duplicate = await request("PUT", {
			...DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
			rules: [
				DEFAULT_PROVIDER_KEY_ALERT_RULES[0],
				DEFAULT_PROVIDER_KEY_ALERT_RULES[0],
			],
		});
		expect(duplicate.status).toBe(400);
	});

	test("only owners and admins can save", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.organizationId, organizationId));
		expect((await request()).status).toBe(200);
		expect(
			(await request("PUT", DEFAULT_PROVIDER_KEY_ALERT_SETTINGS)).status,
		).toBe(403);
	});
});
