import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "data-streams-org";

describe("data streams", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Data Streams Org",
			billingEmail: "data-streams@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function call(method: string, path: string, body?: unknown) {
		return app.request(path, {
			method,
			headers: { "Content-Type": "application/json", Cookie: token },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	test("data streams never return secrets and validate replay windows", async () => {
		const created = await call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name: "Splunk SIEM",
			source: "audit_logs",
			destination: "splunk",
			config: { url: "https://splunk.example.com:8088" },
			secret: { token: ["hec", "spec", "token"].join("-") },
		});
		expect(created.status).toBe(200);
		const text = await created.text();
		expect(text.includes("hec-spec-token")).toBe(false);
		const { stream } = JSON.parse(text);
		expect(stream.secretFields).toEqual(["token"]);

		const [row] = await db
			.select({ secret: tables.dataStream.secret })
			.from(tables.dataStream)
			.where(eq(tables.dataStream.id, stream.id));
		expect(row.secret?.includes("hec-spec-token")).toBe(false);

		const invalid = await call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name: "Bad",
			source: "audit_logs",
			destination: "datadog",
			config: { site: "datadoghq.com" },
			secret: {},
		});
		expect(invalid.status).toBe(400);

		const future = await call("POST", `/data-streams/${stream.id}/replay`, {
			from: new Date(Date.now() - 3_600_000).toISOString(),
			to: new Date(Date.now() + 3_600_000).toISOString(),
		});
		expect(future.status).toBe(400);

		const replay = await call("POST", `/data-streams/${stream.id}/replay`, {
			from: new Date(Date.now() - 7_200_000).toISOString(),
			to: new Date(Date.now() - 3_600_000).toISOString(),
		});
		expect(replay.status).toBe(200);
		expect((await replay.json()).stream.replayFrom).not.toBeNull();

		const paused = await call("PATCH", `/data-streams/${stream.id}`, {
			enabled: false,
		});
		expect((await paused.json()).stream.enabled).toBe(false);
	});

	test("a partial config update keeps the fields it leaves out", async () => {
		const config = {
			bucket: "logs",
			region: "auto",
			endpoint: "https://r2.example.com",
			accessKeyId: "spec-access-key",
		};
		const created = await call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name: "R2 export",
			source: "request_logs",
			destination: "s3",
			config,
			secret: { secretAccessKey: ["spec", "secret", "key"].join("-") },
		});
		expect(created.status).toBe(200);
		const { stream } = await created.json();

		const updated = await call("PATCH", `/data-streams/${stream.id}`, {
			config: { includePayloads: true },
		});
		expect(updated.status).toBe(200);
		expect((await updated.json()).stream.config).toEqual({
			...config,
			includePayloads: true,
		});
	});

	test("data streams require enterprise", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));
		const list = await call("GET", `/data-streams?organizationId=${ORG_ID}`);
		expect(list.status).toBe(403);
	});
});
