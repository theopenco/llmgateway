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

	function labelMap(prompt: { labels: { label: string; version: number }[] }) {
		return Object.fromEntries(prompt.labels.map((l) => [l.label, l.version]));
	}

	test("prompt lifecycle: create, version, labels, audit", async () => {
		const created = await call("POST", "/prompts", {
			projectId: PROJECT_ID,
			name: "support-reply",
			messages: [{ role: "user", content: "Answer {{question}} for {{plan}}" }],
			model: "gpt-4o-mini",
			parameters: { temperature: 0.3, reasoning_effort: "max" },
		});
		expect(created.status).toBe(200);
		const { prompt, version } = await created.json();
		expect(labelMap(prompt)).toEqual({ production: 1 });
		expect(version.variables).toEqual(["question", "plan"]);
		expect(version.parameters).toEqual({
			temperature: 0.3,
			reasoning_effort: "max",
		});

		const duplicate = await call("POST", "/prompts", {
			projectId: PROJECT_ID,
			name: "support-reply",
			messages: [{ role: "user", content: "x" }],
		});
		expect(duplicate.status).toBe(409);

		const v2 = await call("POST", `/prompts/${prompt.id}/versions`, {
			messages: [{ role: "user", content: "Short answer to {{question}}" }],
			commitMessage: "shorter",
			labels: ["staging"],
		});
		expect(v2.status).toBe(200);
		const v2json = await v2.json();
		expect(v2json.version.version).toBe(2);
		expect(labelMap(v2json.prompt)).toEqual({ production: 1, staging: 2 });

		const deployed = await call(
			"PUT",
			`/prompts/${prompt.id}/labels/production`,
			{ version: 2 },
		);
		expect(deployed.status).toBe(200);
		expect(labelMap((await deployed.json()).prompt)).toEqual({
			production: 2,
			staging: 2,
		});

		const missing = await call(
			"PUT",
			`/prompts/${prompt.id}/labels/production`,
			{ version: 9 },
		);
		expect(missing.status).toBe(404);

		const reserved = await call("PUT", `/prompts/${prompt.id}/labels/latest`, {
			version: 1,
		});
		expect(reserved.status).toBe(400);

		const numeric = await call("PUT", `/prompts/${prompt.id}/labels/3`, {
			version: 1,
		});
		expect(numeric.status).toBe(400);

		const keepProduction = await call(
			"DELETE",
			`/prompts/${prompt.id}/labels/production`,
		);
		expect(keepProduction.status).toBe(400);

		const removed = await call(
			"DELETE",
			`/prompts/${prompt.id}/labels/staging`,
		);
		expect(labelMap((await removed.json()).prompt)).toEqual({ production: 2 });
		expect(
			(await call("DELETE", `/prompts/${prompt.id}/labels/staging`)).status,
		).toBe(404);

		const detail = await (await call("GET", `/prompts/${prompt.id}`)).json();
		expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([
			2, 1,
		]);
		expect(labelMap(detail.prompt)).toEqual({ production: 2 });

		const list = await (
			await call("GET", `/prompts?projectId=${PROJECT_ID}`)
		).json();
		expect(labelMap(list.prompts[0])).toEqual({ production: 2 });

		const audits = await db
			.select({ action: tables.auditLog.action })
			.from(tables.auditLog)
			.where(eq(tables.auditLog.resourceId, prompt.id));
		expect(audits.map((a) => a.action).sort()).toEqual([
			"prompt.create",
			"prompt.deploy",
			"prompt.label_delete",
			"prompt.version_create",
		]);

		expect((await call("DELETE", `/prompts/${prompt.id}`)).status).toBe(200);
		expect((await call("GET", `/prompts/${prompt.id}`)).status).toBe(404);
	});
});
