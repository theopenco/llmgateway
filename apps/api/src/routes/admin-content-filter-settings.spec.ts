import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { getContentFilterSettings } from "@/lib/content-filter-settings.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { providers } from "@llmgateway/models";

const originalAdminEmails = process.env.ADMIN_EMAILS;

describe("admin content filter settings", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	test("returns log-only defaults with every provider disabled", async () => {
		const res = await app.request("/admin/settings/content-filter", {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			enabled: true,
			sampleRatePercent: 100,
			enforce: false,
			enforceEnterprise: false,
		});
		expect(body.providers).toHaveLength(providers.length);
		expect(body.providers.every((p: { enabled: boolean }) => !p.enabled)).toBe(
			true,
		);
	});

	test("requires authentication", async () => {
		const res = await app.request("/admin/settings/content-filter");
		expect(res.status).toBe(401);
	});

	test("stores settings and enabled providers", async () => {
		const res = await app.request("/admin/settings/content-filter", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				providerIds: ["openai", "anthropic", "openai"],
				sampleRatePercent: 25,
				enforce: true,
				enforceEnterprise: false,
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ sampleRatePercent: 25, enforce: true });
		expect(
			body.providers
				.filter((p: { enabled: boolean }) => p.enabled)
				.map((p: { id: string }) => p.id)
				.sort(),
		).toEqual(["anthropic", "openai"]);
		expect(await getContentFilterSettings()).toEqual({
			enabled: true,
			providerIds: ["openai", "anthropic"],
			sampleRatePercent: 25,
			enforce: true,
			enforceEnterprise: false,
		});
	});

	test("rejects unknown providers and out-of-range sample rates", async () => {
		const unknown = await app.request("/admin/settings/content-filter", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				providerIds: ["not-a-provider"],
				sampleRatePercent: 100,
				enforce: false,
				enforceEnterprise: false,
			}),
		});
		expect(unknown.status).toBe(400);

		const rate = await app.request("/admin/settings/content-filter", {
			method: "PUT",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				providerIds: [],
				sampleRatePercent: 101,
				enforce: false,
				enforceEnterprise: false,
			}),
		});
		expect(rate.status).toBe(400);

		expect((await getContentFilterSettings()).providerIds).toEqual([]);
	});
});
