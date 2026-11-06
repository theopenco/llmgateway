import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";

describe("provider credential usage windows", () => {
	let cookie: string;
	const keyId = "usage-window-key";
	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: "usage-org",
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
		await db.insert(tables.project).values({
			id: "usage-project",
			name: "Test Project",
			organizationId: "usage-org",
		});
		for (const id of [keyId, "usage-empty", "usage-other"]) {
			await db.insert(tables.providerKey).values({
				id,
				provider: "openai",
				managed: true,
				usage: "100",
				usageLimit: "200",
				...encryptProviderKeyForStorage("test-token", id, null),
			});
		}
		const hour = new Date();
		hour.setUTCMinutes(0, 0, 0);
		await db.insert(tables.providerKeyHourlyStats).values(
			[
				[0, 1],
				[23, 2],
				[25, 4],
				[6 * 24, 8],
				[8 * 24, 16],
				[29 * 24, 32],
				[31 * 24, 64],
				[-2, 128],
			].map(([hoursAgo, cost]) => {
				const offsetMs = hoursAgo * 3600000;
				return {
					providerKeyId: keyId,
					projectId: "usage-project",
					hourTimestamp: new Date(hour.getTime() - offsetMs),
					cost,
					requestCount: 1,
				};
			}),
		);
		await db.insert(tables.providerKeyHourlyStats).values({
			providerKeyId: "usage-other",
			projectId: "usage-project",
			hourTimestamp: hour,
			cost: 512,
			requestCount: 1,
		});
	});
	afterEach(async () => {
		await deleteAll();
	});
	async function list(query = "") {
		const res = await app.request(`/admin/provider-credentials${query}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		return (await res.json()) as {
			credentials: {
				id: string;
				usage: string;
				usageLimit: string | null;
				windowUsage: string;
			}[];
		};
	}
	test.each([
		["1d", 3],
		["7d", 15],
		["30d", 63],
	] as const)(
		"sums only %s hourly usage without changing the lifetime cap",
		async (window, expected) => {
			const { credentials } = await list(`?usageWindow=${window}`);
			const key = credentials.find(({ id }) => id === keyId)!;
			expect(Number(key.windowUsage)).toBe(expected);
			expect(key.usage).toBe("100");
			expect(key.usageLimit).toBe("200");
			expect(
				credentials.find(({ id }) => id === "usage-empty")?.windowUsage,
			).toBe("0");
		},
	);
	test.each(["", "?usageWindow=all"])(
		"preserves the lifetime counter for all time (%s)",
		async (query) => {
			const { credentials } = await list(query);
			expect(credentials.find(({ id }) => id === keyId)?.windowUsage).toBe(
				"100",
			);
		},
	);
	test("rejects unsupported windows", async () => {
		const res = await app.request(
			"/admin/provider-credentials?usageWindow=2d",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(400);
	});
});
