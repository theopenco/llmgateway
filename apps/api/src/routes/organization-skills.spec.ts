import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const organizationId = "skill-test-org";
const otherOrganizationId = "skill-other-org";
const projectId = "skill-test-project";
const membershipId = "skill-test-membership";
const apiKeyId = "skill-test-key";
const token = "test-token";
const content =
	"---\nname: code-review\ndescription: >-\n  Review changes for correctness\n  and maintainability.\nlicense: MIT\n---\n\n# Code review\nRead references/checklist.md before reviewing.\n";
const files = [
	{
		path: "references/checklist.md",
		content: "Check error handling and test coverage.",
	},
	{ path: "assets/example.bin", content: "AAECAw==", encoding: "base64" },
];

describe("organization skills", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: organizationId,
				name: "Skills Test",
				plan: "enterprise",
				billingEmail: "billing@example.com",
			},
			{
				id: otherOrganizationId,
				name: "Other Skills Test",
				plan: "enterprise",
				billingEmail: "other-billing@example.com",
			},
		]);
		await db.insert(tables.userOrganization).values({
			id: membershipId,
			organizationId,
			userId: "test-user-id",
			role: "owner",
		});
		await db
			.insert(tables.project)
			.values({ id: projectId, name: "Skills Project", organizationId });
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(token),
			description: "Skills CLI",
			projectId,
			createdBy: "test-user-id",
		});
	});
	afterEach(deleteAll);

	function dashboard(
		path = "",
		method = "GET",
		body?: unknown,
		org = organizationId,
	) {
		return app.request(`/orgs/${org}/skills${path}`, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}
	function cli(path = "", credential = token) {
		return app.request(`/v1/skills${path}`, {
			headers: { Authorization: `Bearer ${credential}` },
		});
	}
	async function createSkill() {
		const response = await dashboard("", "POST", { content, files });
		expect(response.status).toBe(201);
		return (await response.json()).skill as { id: string; name: string };
	}

	test("publishes an imported bundle, updates it, disables it, and deletes it", async () => {
		const skill = await createSkill();
		const list = await cli();
		expect(list.status).toBe(200);
		expect(list.headers.get("cache-control")).toBe("private, no-store");
		expect((await list.json()).skills).toEqual([
			expect.objectContaining({
				id: skill.id,
				name: "code-review",
				description: "Review changes for correctness and maintainability.",
			}),
		]);
		const bundle = await cli("/code-review");
		expect(bundle.status).toBe(200);
		expect((await bundle.json()).skill).toMatchObject({
			content,
			files,
			enabled: true,
		});
		const updatedContent = content.replace(
			"# Code review",
			"# Updated code review",
		);
		const update = await dashboard(`/${skill.id}`, "PUT", {
			content: updatedContent,
			files,
		});
		expect(update.status).toBe(200);
		expect((await (await cli("/code-review")).json()).skill.content).toBe(
			updatedContent,
		);
		expect(
			(await dashboard(`/${skill.id}`, "PATCH", { enabled: false })).status,
		).toBe(200);
		expect((await (await cli()).json()).skills).toEqual([]);
		expect((await cli("/code-review")).status).toBe(404);
		expect((await (await dashboard()).json()).skills).toHaveLength(1);
		expect(
			(await dashboard(`/${skill.id}`, "PATCH", { enabled: true })).status,
		).toBe(200);
		expect((await cli("/code-review")).status).toBe(200);
		expect((await dashboard(`/${skill.id}`, "DELETE")).status).toBe(200);
		expect((await cli("/code-review")).status).toBe(404);
		const events = await db.query.auditLog.findMany({
			where: {
				organizationId: { eq: organizationId },
				resourceId: { eq: skill.id },
			},
		});
		expect(events.map((event) => event.action)).toEqual(
			expect.arrayContaining([
				"organization_skill.create",
				"organization_skill.update",
				"organization_skill.delete",
			]),
		);
		expect(
			events.every(
				(event) => !JSON.stringify(event.metadata).includes("Code review"),
			),
		).toBe(true);
	});

	test("allows developers to read but only owners and admins to manage", async () => {
		const skill = await createSkill();
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, membershipId));
		await db
			.insert(tables.userProject)
			.values({ userOrganizationId: membershipId, projectId });
		expect((await dashboard()).status).toBe(200);
		expect((await dashboard(`/${skill.id}`)).status).toBe(200);
		expect((await cli("/code-review")).status).toBe(200);
		for (const method of ["PUT", "PATCH", "DELETE"]) {
			const body =
				method === "PUT"
					? { content, files }
					: method === "PATCH"
						? { enabled: false }
						: undefined;
			expect((await dashboard(`/${skill.id}`, method, body)).status).toBe(403);
		}
		expect((await dashboard("", "POST", { content })).status).toBe(403);
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.id, membershipId));
		expect(
			(await dashboard(`/${skill.id}`, "PATCH", { enabled: false })).status,
		).toBe(200);
	});

	test("isolates organizations even when skill names match", async () => {
		const skill = await createSkill();
		const [other] = await db
			.insert(tables.organizationSkill)
			.values({
				id: "other-skill",
				organizationId: otherOrganizationId,
				name: "code-review",
				description: "Other skill",
				content: "Private content",
			})
			.returning();
		expect(
			(await dashboard("", "GET", undefined, otherOrganizationId)).status,
		).toBe(404);
		expect((await dashboard(`/${other.id}`)).status).toBe(404);
		expect((await dashboard(`/${other.id}`, "PUT", { content })).status).toBe(
			404,
		);
		expect(
			(await dashboard(`/${other.id}`, "PATCH", { enabled: false })).status,
		).toBe(404);
		expect((await dashboard(`/${other.id}`, "DELETE")).status).toBe(404);
		expect((await (await cli("/code-review")).json()).skill.id).toBe(skill.id);
		expect((await cli(`/${other.id}`)).status).toBe(404);
	});

	test("rejects duplicate names atomically and keeps download names stable", async () => {
		const responses = await Promise.all([
			dashboard("", "POST", { content }),
			dashboard("", "POST", { content }),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([
			201, 409,
		]);
		const created = await responses
			.find((response) => response.status === 201)!
			.json();
		expect(
			(
				await dashboard(`/${created.skill.id}`, "PUT", {
					content: content.replace("name: code-review", "name: another-name"),
				})
			).status,
		).toBe(400);
	});

	test.each(["inactive", "deleted"] as const)(
		"rejects %s API keys",
		async (status) => {
			await createSkill();
			await db
				.update(tables.apiKey)
				.set({ status })
				.where(eq(tables.apiKey.id, apiKeyId));
			expect((await cli()).status).toBe(401);
			expect((await cli("/code-review")).status).toBe(401);
		},
	);

	test("rejects expired keys, unrelated key types, and anonymous requests", async () => {
		await db
			.update(tables.apiKey)
			.set({ expiresAt: new Date(0) })
			.where(eq(tables.apiKey.id, apiKeyId));
		expect((await cli()).status).toBe(401);
		for (const keyType of [
			"platform_secret",
			"platform_publishable",
			"end_user_customer",
		] as const) {
			await db
				.update(tables.apiKey)
				.set({ expiresAt: null, keyType })
				.where(eq(tables.apiKey.id, apiKeyId));
			expect((await cli()).status).toBe(401);
		}
		expect((await cli("", "unknown-key")).status).toBe(401);
		expect((await app.request("/v1/skills")).status).toBe(401);
		expect((await app.request(`/orgs/${organizationId}/skills`)).status).toBe(
			401,
		);
	});

	test("rejects removed memberships, project access, and deactivated users", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, membershipId));
		expect((await cli()).status).toBe(403);
		await db
			.insert(tables.userProject)
			.values({ userOrganizationId: membershipId, projectId });
		expect((await cli()).status).toBe(200);
		await db
			.update(tables.user)
			.set({ status: "deactivated" })
			.where(eq(tables.user.id, "test-user-id"));
		expect((await cli()).status).toBe(401);
		await db
			.update(tables.user)
			.set({ status: "active" })
			.where(eq(tables.user.id, "test-user-id"));
		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.id, membershipId));
		expect((await cli()).status).toBe(403);
	});

	test("enforces enterprise access and active organization and project state", async () => {
		await createSkill();
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, organizationId));
		expect((await cli()).status).toBe(403);
		expect((await dashboard()).status).toBe(403);
		expect((await dashboard("", "POST", { content })).status).toBe(403);
		await db
			.update(tables.organization)
			.set({ plan: "enterprise", status: "inactive" })
			.where(eq(tables.organization.id, organizationId));
		expect((await cli()).status).toBe(403);
		expect((await dashboard()).status).toBe(404);
		await db
			.update(tables.organization)
			.set({ status: "active" })
			.where(eq(tables.organization.id, organizationId));
		await db
			.update(tables.project)
			.set({ status: "inactive" })
			.where(eq(tables.project.id, projectId));
		expect((await cli()).status).toBe(403);
	});

	test.each([
		{ content: "No frontmatter" },
		{ content: "---\nname: ../escape\ndescription: Escape\n---\nInstructions" },
		{ content: "---\nname: code-review\ndescription: Missing body\n---" },
		{
			content:
				"---\nname: code-review\nname: duplicate\ndescription: Duplicate\n---\nInstructions",
		},
		{ content, files: [{ path: "../escape.md", content: "Outside skill" }] },
		{ content, files: [{ path: "/absolute.md", content: "Outside skill" }] },
		{
			content,
			files: [{ path: "scripts\\escape.sh", content: "Outside skill" }],
		},
		{ content, files: [{ path: "skill.md", content: "Override metadata" }] },
		{
			content,
			files: [{ path: "SKILL.md/nested.md", content: "File conflict" }],
		},
		{
			content,
			files: [
				{ path: "a.md", content: "One" },
				{ path: "A.md", content: "Two" },
			],
		},
		{
			content,
			files: [
				{ path: "scripts", content: "File" },
				{ path: "scripts/check.sh", content: "Nested" },
			],
		},
		{
			content,
			files: [{ path: "asset.bin", content: "invalid!", encoding: "base64" }],
		},
		{
			content,
			files: [{ path: "large.md", content: "a".repeat(1024 * 1024) }],
		},
	])(
		"rejects malformed or unsafe skill bundles ($files.0.path)",
		async (body) => {
			expect((await dashboard("", "POST", body)).status).toBe(400);
		},
	);
});
