import { beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb as db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type { ProviderAccessRestriction } from "@llmgateway/models";

const RESTRICTION_MESSAGE = "restricted for your organization";

describe("staff-managed provider access restriction", () => {
	const harness = createGatewayApiTestHarness();
	const headers = {
		"Content-Type": "application/json",
		Authorization: "Bearer restriction-token",
	};

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "restriction-key",
			...hashApiKeyForStorage("restriction-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Provider access restriction test key",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-openai",
			...encryptProviderKeyForStorage(
				"openai-test-key",
				"provider-key-openai",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	});

	async function restrict(restriction: Partial<ProviderAccessRestriction>) {
		await db
			.update(tables.organization)
			.set({
				providerAccessRestriction: {
					mode: "deny",
					providers: [],
					models: [],
					mappings: [],
					...restriction,
				},
			})
			.where(eq(tables.organization.id, "org-id"));
	}

	function chat(model: string) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: `Hello ${model}!` }],
			}),
		});
	}

	async function expectRestricted(res: Response) {
		expect(res.status).toBe(403);
		expect(JSON.stringify(await res.json())).toContain(RESTRICTION_MESSAGE);
	}

	test("serves requests when no restriction is set", async () => {
		expect((await chat("gpt-4o-mini")).status).toBe(200);
	});

	test("a restriction on another organization never affects this one", async () => {
		await db.insert(tables.organization).values({
			id: "other-restricted-org",
			name: "Other Restricted Org",
			billingEmail: "other-restricted@example.com",
			providerAccessRestriction: {
				mode: "allow",
				providers: ["anthropic"],
				models: [],
				mappings: [],
			},
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-anthropic",
			...encryptProviderKeyForStorage(
				"anthropic-test-key",
				"provider-key-anthropic",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		expect((await chat("gpt-4o-mini")).status).toBe(200);
		expect((await chat("openai/gpt-4o-mini")).status).toBe(200);
		expect((await chat("auto")).status).toBe(200);
		const embeddings = await app.request("/v1/embeddings", {
			method: "POST",
			headers,
			body: JSON.stringify({ input: "Hello", model: "text-embedding-3-small" }),
		});
		expect(embeddings.status).toBe(200);
	});

	test("an unrestricted organization sees the same models as before", async () => {
		const list = async () => {
			const res = await app.request("/v1/models", {
				headers: { Authorization: "Bearer restriction-token" },
			});
			expect(res.status).toBe(200);
			return ((await res.json()) as { data: { id: string }[] }).data.map(
				(model) => model.id,
			);
		};
		const unrestricted = await list();
		expect(unrestricted.length).toBeGreaterThan(50);

		await restrict({ models: ["gpt-4o-mini"] });
		const restricted = await list();
		expect(restricted).not.toContain("gpt-4o-mini");

		await db
			.update(tables.organization)
			.set({ providerAccessRestriction: null })
			.where(eq(tables.organization.id, "org-id"));
		expect(await list()).toEqual(unrestricted);
	});

	test("deny list blocks a model", async () => {
		await restrict({ models: ["gpt-4o-mini"] });

		await expectRestricted(await chat("gpt-4o-mini"));
	});

	test("deny list blocks an explicitly requested provider", async () => {
		await restrict({ providers: ["openai"] });

		await expectRestricted(await chat("openai/gpt-4o-mini"));
	});

	test("allow list only serves listed mappings", async () => {
		await restrict({ mode: "allow", mappings: ["openai/gpt-4o-mini"] });

		expect((await chat("gpt-4o-mini")).status).toBe(200);
		await expectRestricted(await chat("gpt-4o"));
	});

	test("auto routing skips restricted candidates", async () => {
		await db.insert(tables.providerKey).values({
			id: "provider-key-anthropic",
			...encryptProviderKeyForStorage(
				"anthropic-test-key",
				"provider-key-anthropic",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		await restrict({ models: ["claude-haiku-4-5"] });

		const res = await chat("auto");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { model: string };
		expect(body.model).not.toContain("haiku");
	});

	test("auto routing's default fallback cannot reach a denied provider", async () => {
		await db.insert(tables.providerKey).values({
			id: "provider-key-anthropic",
			...encryptProviderKeyForStorage(
				"anthropic-test-key",
				"provider-key-anthropic",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		await restrict({ providers: ["anthropic"] });

		await expectRestricted(await chat("auto"));
	});

	test("applies to organization custom providers", async () => {
		await db.insert(tables.providerKey).values({
			id: "provider-key-custom",
			...encryptProviderKeyForStorage(
				"custom-test-key",
				"provider-key-custom",
				"org-id",
			),
			provider: "custom",
			name: "mycustom",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});

		expect((await chat("mycustom/gpt-4o-mini")).status).toBe(200);

		await restrict({ mode: "allow", providers: ["openai"] });
		await expectRestricted(await chat("mycustom/gpt-4o-mini"));

		await restrict({ providers: ["custom"] });
		await expectRestricted(await chat("mycustom/gpt-4o-mini"));
	});

	test("applies to non-chat endpoints", async () => {
		await restrict({ providers: ["openai"] });

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers,
			body: JSON.stringify({
				input: "Hello",
				model: "text-embedding-3-small",
			}),
		});

		await expectRestricted(res);
	});

	test("hides restricted models from model discovery", async () => {
		await restrict({ mode: "allow", models: ["gpt-4o-mini"] });

		const res = await app.request("/v1/models", {
			headers: { Authorization: "Bearer restriction-token" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { id: string }[] };
		// The auto/smart routing pseudo-models stay listed: they only resolve to
		// models the restriction allows.
		expect(
			body.data
				.map((model) => model.id)
				.filter((id) => id !== "auto" && id !== "smart"),
		).toEqual(["gpt-4o-mini"]);
	});
});
