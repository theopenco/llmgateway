import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { apiKeyHourlyModelStats, db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

interface UsageRow {
	date: string | null;
	userId: string | null;
	userName: string | null;
	userEmail: string | null;
	projectId: string | null;
	projectName: string | null;
	apiKeyId: string | null;
	apiKeyName: string | null;
	model: string | null;
	provider: string | null;
	requestCount: number;
	errorCount: number;
	totalTokens: number;
	cost: number;
}

interface UsageResponse {
	from: string;
	to: string;
	granularity: string;
	groupBy: string[];
	rows: UsageRow[];
	pagination: { limit: number; offset: number; hasMore: boolean };
}

// Fixed window so the assertions never depend on the wall clock.
const FROM = "2026-03-01";
const TO = "2026-03-02";

function statsRow(values: {
	id: string;
	apiKeyId: string;
	projectId: string;
	hour: string;
	usedModel: string;
	usedProvider: string;
	requestCount: number;
	cost: number;
	totalTokens: number;
}) {
	return {
		id: values.id,
		apiKeyId: values.apiKeyId,
		projectId: values.projectId,
		hourTimestamp: new Date(values.hour),
		usedModel: values.usedModel,
		usedProvider: values.usedProvider,
		requestCount: values.requestCount,
		cost: values.cost,
		creditsCost: values.cost,
		creditsRequestCount: values.requestCount,
		inputTokens: String(values.totalTokens),
		totalTokens: String(values.totalTokens),
	};
}

describe("GET /v1/master/usage", () => {
	let masterToken: string;

	beforeEach(async () => {
		// createTestUser runs deleteAll and seeds test-user-id (admin@example.com).
		await createTestUser();

		await db.insert(tables.user).values({
			id: "user-b-id",
			name: "Second Member",
			email: "second@example.com",
			emailVerified: true,
		});

		await db.insert(tables.organization).values([
			{
				id: "test-org-id",
				name: "Test Organization",
				billingEmail: "test@example.com",
				plan: "enterprise",
			},
			{
				id: "other-org-id",
				name: "Other Organization",
				billingEmail: "other@example.com",
				plan: "enterprise",
			},
		]);

		await db.insert(tables.userOrganization).values([
			{
				id: "test-user-org-id",
				userId: "test-user-id",
				organizationId: "test-org-id",
				role: "owner",
			},
			{
				id: "user-b-org-id",
				userId: "user-b-id",
				organizationId: "test-org-id",
				role: "developer",
			},
		]);

		await db.insert(tables.project).values([
			{
				id: "project-1-id",
				name: "Project One",
				organizationId: "test-org-id",
			},
			{
				id: "project-2-id",
				name: "Project Two",
				organizationId: "test-org-id",
			},
			{
				id: "other-project-id",
				name: "Other Project",
				organizationId: "other-org-id",
			},
		]);

		await db.insert(tables.apiKey).values([
			{
				id: "key-a",
				token: "key-a-token",
				projectId: "project-1-id",
				description: "Key A",
				createdBy: "test-user-id",
			},
			{
				id: "key-b",
				token: "key-b-token",
				projectId: "project-1-id",
				description: "Key B",
				createdBy: "user-b-id",
			},
			{
				id: "key-c",
				token: "key-c-token",
				projectId: "project-2-id",
				description: "Key C",
				createdBy: "test-user-id",
			},
			{
				id: "other-key",
				token: "other-key-token",
				projectId: "other-project-id",
				description: "Other Key",
				createdBy: "user-b-id",
			},
		]);

		await db.insert(apiKeyHourlyModelStats).values([
			statsRow({
				id: "stat-1",
				apiKeyId: "key-a",
				projectId: "project-1-id",
				hour: "2026-03-01T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 2,
				cost: 1,
				totalTokens: 150,
			}),
			statsRow({
				id: "stat-2",
				apiKeyId: "key-a",
				projectId: "project-1-id",
				hour: "2026-03-01T11:00:00.000Z",
				usedModel: "claude-sonnet-5",
				usedProvider: "anthropic",
				requestCount: 1,
				cost: 2,
				totalTokens: 15,
			}),
			statsRow({
				id: "stat-3",
				apiKeyId: "key-a",
				projectId: "project-1-id",
				hour: "2026-03-02T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 3,
				cost: 4,
				totalTokens: 300,
			}),
			statsRow({
				id: "stat-4",
				apiKeyId: "key-b",
				projectId: "project-1-id",
				hour: "2026-03-01T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 5,
				cost: 8,
				totalTokens: 3,
			}),
			statsRow({
				id: "stat-5",
				apiKeyId: "key-c",
				projectId: "project-2-id",
				hour: "2026-03-01T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 7,
				cost: 16,
				totalTokens: 70,
			}),
			// Negative control: another organization's traffic must never appear.
			statsRow({
				id: "stat-other",
				apiKeyId: "other-key",
				projectId: "other-project-id",
				hour: "2026-03-01T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 100,
				cost: 1000,
				totalTokens: 9999,
			}),
		]);

		masterToken = `mk-${crypto.randomUUID()}`;
		await db.insert(tables.masterKey).values({
			id: "test-master-key-id",
			tokenHash: getApiKeyFingerprint(masterToken),
			maskedToken: "mk-****",
			description: "Test Master Key",
			status: "active",
			organizationId: "test-org-id",
			createdBy: "test-user-id",
		});
	});

	afterEach(async () => {
		// deleteAll does not target masterKey, but deleting the organization
		// cascades it (masterKey.organizationId ON DELETE cascade).
		await deleteAll();
	});

	async function fetchUsage(
		query: string,
		token = masterToken,
	): Promise<Response> {
		return await app.request(
			`/v1/master/usage?from=${FROM}&to=${TO}&${query}`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
	}

	async function fetchJson(query: string): Promise<UsageResponse> {
		const res = await fetchUsage(query);
		expect(res.status).toBe(200);
		return (await res.json()) as UsageResponse;
	}

	test("rejects a request without a master key", async () => {
		const res = await app.request("/v1/master/usage");
		expect(res.status).toBe(401);
	});

	test("rejects a master key on a non-enterprise organization", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, "test-org-id"));

		const res = await fetchUsage("granularity=total&groupBy=user");
		expect(res.status).toBe(403);
	});

	test("groups by user across the whole organization", async () => {
		const body = await fetchJson("granularity=total&groupBy=user");

		expect(body.granularity).toBe("total");
		expect(body.groupBy).toEqual(["user"]);
		expect(body.pagination).toEqual({
			limit: 1000,
			offset: 0,
			hasMore: false,
		});

		const byUser = indexBy(body.rows, (row) => row.userId!);
		// key-a (2 + 1 + 3) + key-c (7); the other org's 100 requests are excluded.
		expect(byUser.get("test-user-id")).toMatchObject({
			date: null,
			requestCount: 13,
			cost: 23,
			userName: "Test User",
			userEmail: "admin@example.com",
			model: null,
			projectId: null,
		});
		expect(byUser.get("user-b-id")).toMatchObject({
			requestCount: 5,
			cost: 8,
			userName: "Second Member",
		});
		expect(body.rows).toHaveLength(2);
	});

	test("cross-tabs user by model", async () => {
		const body = await fetchJson("granularity=total&groupBy=user,model");

		const byCell = indexBy(body.rows, (row) => `${row.userId}|${row.model}`);
		expect(byCell.get("test-user-id|gpt-5.6")).toMatchObject({
			requestCount: 12,
			cost: 21,
			totalTokens: 520,
		});
		expect(byCell.get("test-user-id|claude-sonnet-5")).toMatchObject({
			requestCount: 1,
			cost: 2,
		});
		expect(byCell.get("user-b-id|gpt-5.6")).toMatchObject({
			requestCount: 5,
			cost: 8,
		});
		expect(body.rows).toHaveLength(3);
	});

	test("buckets by local day and labels providers", async () => {
		const body = await fetchJson("granularity=day&groupBy=user,provider");

		const byCell = indexBy(
			body.rows,
			(row) => `${row.date}|${row.userId}|${row.provider}`,
		);
		expect(byCell.get("2026-03-01|test-user-id|openai")).toMatchObject({
			requestCount: 9,
			cost: 17,
		});
		expect(byCell.get("2026-03-01|test-user-id|anthropic")).toMatchObject({
			requestCount: 1,
			cost: 2,
		});
		expect(byCell.get("2026-03-02|test-user-id|openai")).toMatchObject({
			requestCount: 3,
			cost: 4,
		});
		expect(byCell.get("2026-03-01|user-b-id|openai")).toMatchObject({
			requestCount: 5,
			cost: 8,
		});
		// Rows are ordered by bucket, so the series is already chart-ready.
		expect(body.rows[0].date).toBe("2026-03-01");
		expect(body.rows.at(-1)!.date).toBe("2026-03-02");
	});

	test("buckets in the caller's timezone", async () => {
		// 02:00 UTC on 03-02 is still 03-01 in New York.
		await db.insert(apiKeyHourlyModelStats).values(
			statsRow({
				id: "stat-tz",
				apiKeyId: "key-a",
				projectId: "project-1-id",
				hour: "2026-03-02T02:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 11,
				cost: 32,
				totalTokens: 1,
			}),
		);

		const utc = await fetchJson(
			"granularity=day&groupBy=user&userId=test-user-id",
		);
		const utcByDate = indexBy(utc.rows, (row) => row.date!);
		expect(utcByDate.get("2026-03-01")!.requestCount).toBe(10);
		expect(utcByDate.get("2026-03-02")!.requestCount).toBe(3 + 11);

		const ny = await fetchJson(
			"granularity=day&groupBy=user&userId=test-user-id&timezone=America%2FNew_York",
		);
		const nyByDate = indexBy(ny.rows, (row) => row.date!);
		expect(nyByDate.get("2026-03-01")!.requestCount).toBe(10 + 11);
		expect(nyByDate.get("2026-03-02")!.requestCount).toBe(3);
	});

	test("filters by project, user and api key", async () => {
		const byProject = await fetchJson(
			"granularity=total&groupBy=user&projectId=project-1-id",
		);
		const projectRows = indexBy(byProject.rows, (row) => row.userId!);
		expect(projectRows.get("test-user-id")).toMatchObject({
			requestCount: 6,
			cost: 7,
		});
		expect(projectRows.get("user-b-id")).toMatchObject({ requestCount: 5 });

		const byUser = await fetchJson(
			"granularity=total&groupBy=user&userId=user-b-id",
		);
		expect(byUser.rows).toHaveLength(1);
		expect(byUser.rows[0]).toMatchObject({ userId: "user-b-id", cost: 8 });

		const byKey = await fetchJson(
			"granularity=total&groupBy=apiKey&apiKeyId=key-c",
		);
		expect(byKey.rows).toHaveLength(1);
		expect(byKey.rows[0]).toMatchObject({
			apiKeyId: "key-c",
			apiKeyName: "Key C",
			cost: 16,
		});
	});

	test("rolls playground keys into one api key group", async () => {
		await db.insert(tables.apiKey).values([
			{
				id: "playground-key-1",
				token: "playground-token-1",
				projectId: "project-1-id",
				description: "Auto-generated playground key",
				kind: "playground",
				createdBy: "test-user-id",
			},
			{
				id: "playground-key-2",
				token: "playground-token-2",
				projectId: "project-1-id",
				description: "Auto-generated playground key",
				kind: "playground",
				createdBy: "test-user-id",
			},
		]);
		await db.insert(apiKeyHourlyModelStats).values([
			statsRow({
				id: "stat-playground-1",
				apiKeyId: "playground-key-1",
				projectId: "project-1-id",
				hour: "2026-03-01T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 2,
				cost: 3,
				totalTokens: 30,
			}),
			statsRow({
				id: "stat-playground-2",
				apiKeyId: "playground-key-2",
				projectId: "project-1-id",
				hour: "2026-03-01T10:00:00.000Z",
				usedModel: "gpt-5.6",
				usedProvider: "openai",
				requestCount: 4,
				cost: 5,
				totalTokens: 50,
			}),
		]);

		const body = await fetchJson("granularity=total&groupBy=apiKey");
		const playgroundRows = body.rows.filter(
			(row) => row.apiKeyId === "playground",
		);

		expect(playgroundRows).toHaveLength(1);
		expect(playgroundRows[0]).toMatchObject({
			apiKeyId: "playground",
			apiKeyName: "Playground",
			requestCount: 6,
			cost: 8,
		});
	});

	test("labels projects when grouping by project", async () => {
		const body = await fetchJson("granularity=total&groupBy=project");
		const byProject = indexBy(body.rows, (row) => row.projectId!);
		expect(byProject.get("project-1-id")).toMatchObject({
			projectName: "Project One",
			requestCount: 11,
			cost: 15,
		});
		expect(byProject.get("project-2-id")).toMatchObject({
			projectName: "Project Two",
			requestCount: 7,
		});
		expect(body.rows).toHaveLength(2);
	});

	test("returns a single total row when no dimensions are requested", async () => {
		const body = await fetchJson("granularity=total&groupBy=");
		expect(body.rows).toHaveLength(1);
		expect(body.rows[0]).toMatchObject({
			date: null,
			userId: null,
			model: null,
			requestCount: 18,
			cost: 31,
		});
	});

	test("pages with limit and offset", async () => {
		const first = await fetchJson(
			"granularity=total&groupBy=user,model&limit=2",
		);
		expect(first.rows).toHaveLength(2);
		expect(first.pagination.hasMore).toBe(true);

		const second = await fetchJson(
			"granularity=total&groupBy=user,model&limit=2&offset=2",
		);
		expect(second.rows).toHaveLength(1);
		expect(second.pagination.hasMore).toBe(false);
	});

	test("rejects an unknown groupBy dimension", async () => {
		const res = await fetchUsage("groupBy=user,department");
		expect(res.status).toBe(400);
	});

	test("rejects over-long ranges", async () => {
		const tooLong = await app.request(
			"/v1/master/usage?from=2024-01-01&to=2026-03-02",
			{ headers: { Authorization: `Bearer ${masterToken}` } },
		);
		expect(tooLong.status).toBe(400);

		const tooLongHourly = await app.request(
			"/v1/master/usage?from=2026-01-01&to=2026-03-02&granularity=hour",
			{ headers: { Authorization: `Bearer ${masterToken}` } },
		);
		expect(tooLongHourly.status).toBe(400);
	});

	test("404s on a project outside the organization", async () => {
		const res = await fetchUsage("projectId=other-project-id");
		expect(res.status).toBe(404);
	});

	test("renders CSV", async () => {
		const res = await fetchUsage("granularity=total&groupBy=user&format=csv");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("content-disposition")).toContain(
			`usage-${FROM}-to-${TO}.csv`,
		);

		const lines = (await res.text()).trim().split("\n");
		expect(lines[0].split(",")).toContain("userEmail");
		expect(lines).toHaveLength(3);
		expect(lines.some((line) => line.includes("admin@example.com"))).toBe(true);
	});
});

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
	return new Map(rows.map((row) => [key(row), row]));
}
