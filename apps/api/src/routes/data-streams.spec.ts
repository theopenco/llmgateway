import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "data-streams-org";
const SIGNING_SECRET = ["whsec", "spec", "0123456789abcdef"].join("_");

describe("data streams", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Data Streams Org",
			billingEmail: "data-streams@example.com",
			plan: "enterprise",
			dataStreamsEnabled: true,
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

	function setOrg(values: Partial<typeof tables.organization.$inferInsert>) {
		return db
			.update(tables.organization)
			.set(values)
			.where(eq(tables.organization.id, ORG_ID));
	}

	function createAuditStream(name = "Security SIEM") {
		return call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name,
			source: "audit_logs",
			destination: "webhook",
			config: { url: "https://siem.example.com/llmgateway" },
			secret: { signingSecret: SIGNING_SECRET, token: "bearer-spec-token" },
		});
	}

	test("data streams never return secrets and validate replay windows", async () => {
		const created = await createAuditStream();
		expect(created.status).toBe(200);
		const text = await created.text();
		expect(text.includes("bearer-spec-token")).toBe(false);
		expect(text.includes(SIGNING_SECRET)).toBe(false);
		const { stream } = JSON.parse(text);
		expect(stream.secretFields.sort()).toEqual(["signingSecret", "token"]);

		const [row] = await db
			.select({ secret: tables.dataStream.secret })
			.from(tables.dataStream)
			.where(eq(tables.dataStream.id, stream.id));
		expect(row.secret?.includes("bearer-spec-token")).toBe(false);

		const invalid = await call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name: "Bad",
			source: "audit_logs",
			destination: "webhook",
			config: { url: "https://siem.example.com" },
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

	test("a partial update keeps the config and clears failure state on resume", async () => {
		const created = await createAuditStream();
		const { stream } = await created.json();
		await db
			.update(tables.dataStream)
			.set({
				enabled: false,
				pausedReason: "Paused after 3 rejected deliveries",
				lastError: "Destination responded 413",
				lastErrorAt: new Date(),
				failureCount: 3,
			})
			.where(eq(tables.dataStream.id, stream.id));

		const updated = await call("PATCH", `/data-streams/${stream.id}`, {
			enabled: true,
			secret: { token: "rotated-token" },
		});
		expect(updated.status).toBe(200);
		const body = (await updated.json()).stream;
		expect(body.config).toEqual({ url: "https://siem.example.com/llmgateway" });
		expect(body.enabled).toBe(true);
		expect(body.pausedReason).toBeNull();
		expect(body.lastError).toBeNull();
		expect(body.failureCount).toBe(0);
		expect(body.secretFields.sort()).toEqual(["signingSecret", "token"]);

		const withoutToken = await call("PATCH", `/data-streams/${stream.id}`, {
			secret: { token: null },
		});
		expect(withoutToken.status).toBe(200);
		expect((await withoutToken.json()).stream.secretFields).toEqual([
			"signingSecret",
		]);
	});

	test("only accepts the webhook destination and never a payload opt-in", async () => {
		const splunk = await call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name: "Splunk",
			source: "audit_logs",
			destination: "splunk",
			config: { url: "https://splunk.example.com" },
			secret: { signingSecret: SIGNING_SECRET },
		});
		expect(splunk.status).toBe(400);

		const payloads = await call("POST", "/data-streams", {
			organizationId: ORG_ID,
			name: "Export",
			source: "audit_logs",
			destination: "webhook",
			config: { url: "https://siem.example.com", includePayloads: true },
			secret: { signingSecret: SIGNING_SECRET },
		});
		expect(payloads.status).toBe(400);
	});

	test("request log export needs its own organization switch", async () => {
		const body = {
			organizationId: ORG_ID,
			name: "Warehouse",
			source: "request_logs",
			destination: "webhook",
			config: { url: "https://warehouse.example.com/llmgateway" },
			secret: { signingSecret: SIGNING_SECRET },
		};
		const denied = await call("POST", "/data-streams", body);
		expect(denied.status).toBe(403);
		expect((await denied.json()).message).toContain("Request log export");

		const list = await call("GET", `/data-streams?organizationId=${ORG_ID}`);
		expect((await list.json()).requestLogExportEnabled).toBe(false);

		await setOrg({ requestLogExportEnabled: true });
		const created = await call("POST", "/data-streams", body);
		expect(created.status).toBe(200);
		const { stream } = await created.json();

		// Switching it off again blocks resuming and replaying the stream.
		await setOrg({ requestLogExportEnabled: false });
		const resumed = await call("PATCH", `/data-streams/${stream.id}`, {
			enabled: true,
		});
		expect(resumed.status).toBe(403);
		const replay = await call("POST", `/data-streams/${stream.id}/replay`, {
			from: new Date(Date.now() - 7_200_000).toISOString(),
			to: new Date(Date.now() - 3_600_000).toISOString(),
		});
		expect(replay.status).toBe(403);
		const paused = await call("PATCH", `/data-streams/${stream.id}`, {
			enabled: false,
		});
		expect(paused.status).toBe(200);
	});

	test("data streams require enterprise and a platform admin switch", async () => {
		await setOrg({ dataStreamsEnabled: false });
		const closed = await call("GET", `/data-streams?organizationId=${ORG_ID}`);
		expect(closed.status).toBe(403);
		expect((await closed.json()).message).toContain("not enabled");

		await setOrg({ dataStreamsEnabled: true, plan: "pro" });
		const list = await call("GET", `/data-streams?organizationId=${ORG_ID}`);
		expect(list.status).toBe(403);
	});
});
