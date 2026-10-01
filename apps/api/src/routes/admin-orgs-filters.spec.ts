import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const ENTERPRISE_ORG_ID = "org-filters-enterprise";
const TRIAL_ORG_ID = "org-filters-enterprise-trial";
const DEVPASS_ORG_ID = "org-filters-devpass";
const CHAT_ORG_ID = "org-filters-chat";
const ORG_IDS = [ENTERPRISE_ORG_ID, TRIAL_ORG_ID, DEVPASS_ORG_ID, CHAT_ORG_ID];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
	const offset = days * DAY_MS;
	return new Date(Date.now() - offset);
}

function toDay(date: Date) {
	return date.toISOString().split("T")[0];
}

function makeLog(o: {
	id: string;
	organizationId: string;
	createdAt: Date;
	cost: number;
}) {
	return {
		id: o.id,
		requestId: o.id,
		createdAt: o.createdAt,
		updatedAt: o.createdAt,
		organizationId: o.organizationId,
		projectId: `${o.organizationId}-project`,
		apiKeyId: `${o.organizationId}-key`,
		duration: 100,
		requestedModel: "gpt-4",
		requestedProvider: "openai",
		usedModel: "gpt-4",
		usedProvider: "openai",
		responseSize: 100,
		promptTokens: "10",
		completionTokens: "10",
		totalTokens: "20",
		messages: JSON.stringify([{ role: "user", content: "hi" }]),
		mode: "hybrid" as const,
		usedMode: "credits" as const,
		cost: o.cost,
	};
}

interface OrgListResponse {
	organizations: { id: string; kind: string }[];
	total: number;
}

describe("admin — organizations list filters", () => {
	let cookie: string;

	async function list(query: string) {
		const res = await app.request(`/admin/organizations?limit=100&${query}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as OrgListResponse;
		return {
			...body,
			ids: body.organizations
				.map((o) => o.id)
				.filter((id) => ORG_IDS.includes(id)),
		};
	}

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: ENTERPRISE_ORG_ID,
				name: "Org Filters Enterprise",
				billingEmail: "org-filters-enterprise@example.com",
				plan: "enterprise",
			},
			{
				id: TRIAL_ORG_ID,
				name: "Org Filters Enterprise Trial",
				billingEmail: "org-filters-trial@example.com",
				plan: "enterprise",
				isTrialActive: true,
			},
			{
				id: DEVPASS_ORG_ID,
				name: "Org Filters DevPass",
				billingEmail: "org-filters-devpass@example.com",
				kind: "devpass",
			},
			{
				id: CHAT_ORG_ID,
				name: "Org Filters Chat",
				billingEmail: "org-filters-chat@example.com",
				kind: "chat",
			},
		]);

		await db.insert(tables.project).values(
			ORG_IDS.map((id) => ({
				id: `${id}-project`,
				name: `${id} project`,
				organizationId: id,
			})),
		);

		await db.insert(tables.apiKey).values(
			ORG_IDS.map((id) => ({
				id: `${id}-key`,
				...hashApiKeyForStorage(`${id}-token`),
				projectId: `${id}-project`,
				description: "Key",
				createdBy: "test-user-id",
			})),
		);

		await db.insert(tables.log).values([
			makeLog({
				id: "org-filters-log-1",
				organizationId: ENTERPRISE_ORG_ID,
				createdAt: daysAgo(2),
				cost: 1500,
			}),
			makeLog({
				id: "org-filters-log-2",
				organizationId: TRIAL_ORG_ID,
				createdAt: daysAgo(2),
				cost: 500,
			}),
			// Above the threshold, but only outside a recent window.
			makeLog({
				id: "org-filters-log-3",
				organizationId: DEVPASS_ORG_ID,
				createdAt: daysAgo(200),
				cost: 2000,
			}),
		]);

		await aggregateLogsForTesting();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("filters by organization kind", async () => {
		expect((await list("kind=devpass")).ids).toEqual([DEVPASS_ORG_ID]);
		expect((await list("kind=chat")).ids).toEqual([CHAT_ORG_ID]);
		const defaults = await list("kind=default");
		expect(defaults.ids.sort()).toEqual([ENTERPRISE_ORG_ID, TRIAL_ORG_ID]);
		expect(defaults.organizations.every((o) => o.kind === "default")).toBe(
			true,
		);
	});

	test("filters by plan and trial state, and counts the filtered set", async () => {
		const enterprise = await list("plan=enterprise");
		expect(enterprise.ids.sort()).toEqual([ENTERPRISE_ORG_ID, TRIAL_ORG_ID]);
		expect(enterprise.total).toBe(2);

		const trial = await list("plan=enterprise&trialActive=true");
		expect(trial.ids).toEqual([TRIAL_ORG_ID]);
		expect(trial.total).toBe(1);

		const noTrial = await list("plan=enterprise&trialActive=false");
		expect(noTrial.ids).toEqual([ENTERPRISE_ORG_ID]);
	});

	test("filters by minimum spend within the usage window", async () => {
		const allTime = await list("minSpent=1000");
		expect(allTime.ids.sort()).toEqual([DEVPASS_ORG_ID, ENTERPRISE_ORG_ID]);
		expect(allTime.total).toBe(2);

		const windowed = await list(
			`minSpent=1000&from=${toDay(daysAgo(30))}&to=${toDay(daysAgo(0))}`,
		);
		expect(windowed.ids).toEqual([ENTERPRISE_ORG_ID]);
		expect(windowed.total).toBe(1);
	});

	test("sorts by kind", async () => {
		const asc = await list("sortBy=kind&sortOrder=asc");
		const kinds = asc.organizations.map((o) => o.kind);
		expect(kinds).toEqual([...kinds].sort());
		expect(kinds[0]).toBe("chat");
	});
});
