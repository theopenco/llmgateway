import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "prompts-org";
const PROJECT_ID = "prompts-project";

describe("prompts", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Prompts Org",
			billingEmail: "prompts@example.com",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Prompts Project",
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
});
