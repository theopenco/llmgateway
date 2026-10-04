import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "enterprise-controls-org";
const PROJECT_ID = "enterprise-controls-project";

describe("prompts, data streams and semantic cache settings", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Enterprise Controls Org",
			billingEmail: "enterprise-controls@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Enterprise Controls Project",
			organizationId: ORG_ID,
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

	test("prompt lifecycle: create, version, deploy, audit", async () => {
		const created = await call("POST", "/prompts", {
			projectId: PROJECT_ID,
			name: "support-reply",
			messages: [{ role: "user", content: "Answer {{question}} for {{plan}}" }],
			model: "gpt-4o-mini",
			parameters: { temperature: 0.3 },
		});
		expect(created.status).toBe(200);
		const { prompt, version } = await created.json();
		expect(prompt.productionVersion).toBe(1);
		expect(version.variables).toEqual(["question", "plan"]);

		const duplicate = await call("POST", "/prompts", {
			projectId: PROJECT_ID,
			name: "support-reply",
			messages: [{ role: "user", content: "x" }],
		});
		expect(duplicate.status).toBe(409);

		const v2 = await call("POST", `/prompts/${prompt.id}/versions`, {
			messages: [{ role: "user", content: "Short answer to {{question}}" }],
			commitMessage: "shorter",
		});
		expect(v2.status).toBe(200);
		const v2json = await v2.json();
		expect(v2json.version.version).toBe(2);
		expect(v2json.prompt.productionVersion).toBe(1);

		const deployed = await call("POST", `/prompts/${prompt.id}/deploy`, {
			version: 2,
		});
		expect((await deployed.json()).prompt.productionVersion).toBe(2);

		const missing = await call("POST", `/prompts/${prompt.id}/deploy`, {
			version: 9,
		});
		expect(missing.status).toBe(404);

		const detail = await (await call("GET", `/prompts/${prompt.id}`)).json();
		expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([
			2, 1,
		]);

		const audits = await db
			.select({ action: tables.auditLog.action })
			.from(tables.auditLog)
			.where(eq(tables.auditLog.resourceId, prompt.id));
		expect(audits.map((a) => a.action).sort()).toEqual([
			"prompt.create",
			"prompt.deploy",
			"prompt.version_create",
		]);

		expect((await call("DELETE", `/prompts/${prompt.id}`)).status).toBe(200);
		expect((await call("GET", `/prompts/${prompt.id}`)).status).toBe(404);
	});

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

	test("data streams and semantic caching require enterprise", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));
		const list = await call("GET", `/data-streams?organizationId=${ORG_ID}`);
		expect(list.status).toBe(403);
		const semantic = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheEnabled: true,
		});
		expect(semantic.status).toBe(403);
	});

	test("enterprise projects can enable semantic caching", async () => {
		const res = await call("PATCH", `/projects/${PROJECT_ID}`, {
			cachingEnabled: true,
			semanticCacheEnabled: true,
			semanticCacheThreshold: 0.9,
		});
		expect(res.status).toBe(200);
		const [project] = await db
			.select()
			.from(tables.project)
			.where(eq(tables.project.id, PROJECT_ID));
		expect(project.semanticCacheEnabled).toBe(true);
		expect(project.semanticCacheThreshold).toBeCloseTo(0.9);
	});

	test("org compliance policy accepts EU data residency", async () => {
		const res = await call("PATCH", `/orgs/${ORG_ID}`, {
			providerCompliancePolicy: { enabled: true, dataResidency: "eu" },
		});
		expect(res.status).toBe(200);
		const [org] = await db
			.select()
			.from(tables.organization)
			.where(eq(tables.organization.id, ORG_ID));
		expect(org.providerCompliancePolicy?.dataResidency).toBe("eu");
	});
});
