import { beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb as db, eq, tables } from "@llmgateway/db";
import { models, providers } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type {
	ModelDefinition,
	ProviderCompliancePolicy,
} from "@llmgateway/models";

interface ListedModel {
	id: string;
	providers: { providerId: string; externalId: string }[];
	pricing: { prompt: string; completion: string };
	context_length?: number;
	max_output?: number;
}

describe("Authenticated model discovery", () => {
	const harness = createGatewayApiTestHarness();
	const headers = { Authorization: "Bearer test-token" };

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "models-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Model discovery test key",
		});
		await harness.setProjectMode("credits");
	});

	async function setPolicy(policy: ProviderCompliancePolicy) {
		await db
			.update(tables.organization)
			.set({ providerCompliancePolicy: policy })
			.where(eq(tables.organization.id, "org-id"));
	}

	async function list(
		query = "",
		requestHeaders: Record<string, string> = headers,
	) {
		const response = await app.request(`/v1/models${query}`, {
			headers: requestHeaders,
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: ListedModel[] };
		return body.data;
	}

	async function addKeyRule(
		ruleType: typeof tables.apiKeyIamRule.$inferInsert.ruleType,
		ruleValue: typeof tables.apiKeyIamRule.$inferInsert.ruleValue,
	) {
		await db
			.insert(tables.apiKeyIamRule)
			.values({ apiKeyId: "models-key", ruleType, ruleValue });
	}

	async function seedCustomModels() {
		await harness.setProjectMode("hybrid");
		for (const name of ["approved", "unattested"]) {
			await db.insert(tables.providerKey).values({
				id: `${name}-key`,
				organizationId: "org-id",
				provider: "custom",
				name,
				...encryptProviderKeyForStorage("test-token", `${name}-key`, "org-id"),
				baseUrl: harness.mockServerUrl,
				complianceAttestation:
					name === "approved" ? { apiTraining: false } : null,
			});
			await db.insert(tables.customModel).values({
				organizationId: "org-id",
				providerKeyId: `${name}-key`,
				modelName: "test-model",
				inputPrice: "1e-6",
				outputPrice: "2e-6",
				contextSize: 8192,
			});
		}
	}

	test("public requests keep the full catalogue even with an active policy", async () => {
		await setPolicy({
			enabled: true,
			allowedModels: ["gpt-4o-mini"],
			allowedProviders: ["openai"],
		});
		const publicModels = await list("", {});
		expect(publicModels.length).toBeGreaterThan(1);
		expect(publicModels.some((model) => model.id === "gpt-4.1")).toBe(true);
		const filtered = await list();
		expect(filtered.map((model) => model.id)).toEqual(["gpt-4o-mini"]);
		expect(
			filtered[0].providers.map((provider) => provider.providerId),
		).toEqual(["openai"]);
		expect(await list("?include_restricted=false")).toEqual(filtered);
	});

	test.each([
		"",
		"mapped=true",
		"include_deactivated=true&exclude_deprecated=true&no_training=true",
	])(
		"include_restricted returns the public catalogue with %s",
		async (query) => {
			await seedCustomModels();
			await setPolicy({ enabled: true, allowedModels: ["gpt-4o-mini"] });
			await addKeyRule("deny_models", { models: ["gpt-4o-mini"] });
			expect(await list()).toEqual([]);
			const publicModels = await list(query ? `?${query}` : "", {});
			const credentials: Record<string, string>[] = [
				headers,
				{ "x-api-key": "test-token" },
			];
			for (const requestHeaders of credentials) {
				expect(
					await list(`?include_restricted=true&${query}`, requestHeaders),
				).toEqual(publicModels);
			}
			expect(
				publicModels.some((model) => model.id.includes("test-model")),
			).toBe(false);
		},
	);

	test("include_restricted still rejects invalid credentials", async () => {
		const res = await app.request("/v1/models?include_restricted=true", {
			headers: { Authorization: "Bearer invalid-token" },
		});
		expect(res.status).toBe(401);
	});

	test("prices and limits use only compliant mappings in both views", async () => {
		await setPolicy({
			enabled: true,
			allowedModels: ["gpt-4o-mini"],
			allowedProviders: ["openai"],
		});
		const mapping = models
			.find((model) => model.id === "gpt-4o-mini")!
			.providers.find((provider) => provider.providerId === "openai")!;
		for (const query of ["", "?mapped=true&no_training=true"]) {
			const listed = await list(query);
			expect(listed).toHaveLength(1);
			expect(listed[0].id).toBe(query ? "openai/gpt-4o-mini" : "gpt-4o-mini");
			expect(listed[0].pricing).toMatchObject({
				prompt: mapping.inputPrice,
				completion: mapping.outputPrice,
			});
			expect(listed[0].context_length).toBe(mapping.contextSize);
			expect(listed[0].max_output).toBe(mapping.maxOutput);
		}
	});

	test("lifecycle filters do not bypass access restrictions", async () => {
		await setPolicy({
			enabled: true,
			allowedModels: ["gpt-4o-mini"],
			blockedModels: ["gpt-4o-mini"],
		});
		expect(await list("?include_deactivated=true&mapped=true")).toEqual([]);
	});

	test("data policies fail closed for unknown provider posture", async () => {
		await setPolicy({ enabled: true, blockApiTraining: true });
		const listed = await list();
		expect(listed.length).toBeGreaterThan(0);
		for (const model of listed) {
			for (const mapping of model.providers) {
				expect(
					providers.find((provider) => provider.id === mapping.providerId)
						?.dataPolicy?.apiTraining,
				).toBe(false);
			}
		}
	});

	test("disabled policies leave unrestricted keys with the public catalogue", async () => {
		await setPolicy({ enabled: false, allowedModels: ["gpt-4o-mini"] });
		expect((await list()).map((model) => model.id)).toEqual(
			(await list("", {})).map((model) => model.id),
		);
	});

	test("combines team, member, key and compliance restrictions", async () => {
		await db.insert(tables.organizationTeam).values({
			id: "models-team",
			organizationId: "org-id",
			name: "Model discovery team",
		});
		await db
			.insert(tables.organizationTeamProject)
			.values({ teamId: "models-team", projectId: "project-id" });
		await db
			.insert(tables.userProject)
			.values({ userOrganizationId: "user-org-id", projectId: "project-id" });
		await db
			.update(tables.userOrganization)
			.set({ role: "developer", teamId: "models-team" })
			.where(eq(tables.userOrganization.id, "user-org-id"));
		await db.insert(tables.organizationTeamIamRule).values({
			teamId: "models-team",
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4o-mini", "gpt-4.1"] },
		});
		await db.insert(tables.userIamRule).values({
			userOrganizationId: "user-org-id",
			ruleType: "deny_models",
			ruleValue: { models: ["gpt-4.1"] },
		});
		await addKeyRule("allow_providers", { providers: ["openai"] });
		await setPolicy({ enabled: true, blockApiTraining: true });
		const listed = await list();
		expect(listed.map((model) => model.id)).toEqual(["gpt-4o-mini"]);
		expect(listed[0].providers.map((provider) => provider.providerId)).toEqual([
			"openai",
		]);
		await setPolicy({ enabled: true, blockedProviders: ["openai"] });
		expect(await list()).toEqual([]);
		expect(await list("?include_restricted=true")).toEqual(await list("", {}));
	});

	test("honors IP and pricing rules using the request IP", async () => {
		await addKeyRule("allow_ip_cidrs", { ipCidrs: ["192.0.2.0/24"] });
		await addKeyRule("allow_pricing", { pricingType: "paid" });
		expect(await list()).toEqual([]);
		const listed = await list("", {
			...headers,
			"x-forwarded-for": "192.0.2.1",
		});
		expect(listed.length).toBeGreaterThan(0);
		for (const model of listed) {
			expect(
				(
					models.find((definition) => definition.id === model.id) as
						ModelDefinition | undefined
				)?.free === true,
			).toBe(false);
		}
	});

	test.each<Record<string, string>>([
		{ Authorization: "Bearer invalid-token" },
		{ Authorization: "Basic invalid-token" },
		{ Authorization: "" },
		{ "x-api-key": "" },
	])("rejects invalid credentials %j", async (requestHeaders) => {
		const res = await app.request("/v1/models", { headers: requestHeaders });
		expect(res.status).toBe(401);
	});

	test.each(["inactive", "expired"])("rejects %s keys", async (state) => {
		await db
			.update(tables.apiKey)
			.set(
				state === "inactive"
					? { status: "inactive" }
					: { expiresAt: new Date(0) },
			)
			.where(eq(tables.apiKey.id, "models-key"));
		expect((await app.request("/v1/models", { headers })).status).toBe(401);
	});

	test("accepts x-api-key and prevents shared response caching", async () => {
		const res = await app.request("/v1/models", {
			headers: { "x-api-key": "test-token" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		for (const response of [res, await app.request("/v1/models")]) {
			expect(response.headers.get("Vary")).toContain("Authorization");
			expect(response.headers.get("Vary")).toContain("x-api-key");
		}
	});

	test("publishable identifiers cannot discover organization models", async () => {
		await db
			.update(tables.apiKey)
			.set({ keyType: "platform_publishable" })
			.where(eq(tables.apiKey.id, "models-key"));
		expect((await app.request("/v1/models", { headers })).status).toBe(403);
	});

	test("rejects archived projects and revoked member access", async () => {
		await db
			.update(tables.project)
			.set({ status: "deleted" })
			.where(eq(tables.project.id, "project-id"));
		expect((await app.request("/v1/models", { headers })).status).toBe(410);
		await db
			.update(tables.project)
			.set({ status: "active" })
			.where(eq(tables.project.id, "project-id"));
		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.id, "user-org-id"));
		expect((await app.request("/v1/models", { headers })).status).toBe(403);
	});

	test("BYOK projects only list providers with active credentials", async () => {
		await harness.setProjectMode("api-keys");
		await db.insert(tables.providerKey).values({
			id: "openai-key",
			organizationId: "org-id",
			provider: "openai",
			...encryptProviderKeyForStorage("test-token", "openai-key", "org-id"),
		});
		const listed = await list();
		expect(listed.some((model) => model.id === "gpt-4o-mini")).toBe(true);
		expect(
			listed
				.flatMap((model) => model.providers)
				.every((provider) =>
					["openai", "llmgateway"].includes(provider.providerId),
				),
		).toBe(true);
	});

	test("custom models are private and use routable IDs in both views", async () => {
		await seedCustomModels();
		for (const query of ["", "?mapped=true"]) {
			const listed = await list(query);
			const custom = listed.find((model) => model.id === "approved/test-model");
			expect(custom?.pricing).toMatchObject({
				prompt: "1e-6",
				completion: "2e-6",
			});
			expect(custom?.context_length).toBe(8192);
			expect(
				(await list(query, {})).some((model) =>
					model.id.includes("test-model"),
				),
			).toBe(false);
		}
	});

	test("another organization's key cannot discover private custom models", async () => {
		await seedCustomModels();
		await db.insert(tables.organization).values({
			id: "other-org",
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
		await db.insert(tables.project).values({
			id: "other-project",
			name: "Test Project",
			organizationId: "other-org",
			mode: "credits",
		});
		await db
			.insert(tables.userOrganization)
			.values({ userId: "user-id", organizationId: "other-org" });
		await db.insert(tables.apiKey).values({
			id: "other-key",
			...hashApiKeyForStorage("other-test-token"),
			projectId: "other-project",
			createdBy: "user-id",
			description: "Other model discovery key",
		});
		expect(
			(await list()).some((model) => model.id === "approved/test-model"),
		).toBe(true);
		expect(
			(await list("", { Authorization: "Bearer other-test-token" })).some(
				(model) => model.id.includes("test-model"),
			),
		).toBe(false);
	});

	test("retired mappings cannot keep a model visible by default", async () => {
		const now = new Date();
		const definition = (models as ModelDefinition[]).find(
			(model) =>
				model.providers.some(
					(provider) => provider.deactivatedAt && provider.deactivatedAt < now,
				) &&
				model.providers.some(
					(provider) => !provider.deactivatedAt || provider.deactivatedAt > now,
				),
		)!;
		expect(definition).toBeDefined();
		const retired = definition.providers.find(
			(provider) => provider.deactivatedAt && provider.deactivatedAt < now,
		)!;
		await setPolicy({
			enabled: true,
			allowedModels: [definition.id],
			allowedProviders: [retired.providerId],
		});
		expect(await list()).toEqual([]);
		expect(
			(await list("?include_deactivated=true")).map((model) => model.id),
		).toEqual([definition.id]);
	});

	test("custom models require compliant attestations and pass named IAM rules", async () => {
		await seedCustomModels();
		await setPolicy({ enabled: true, blockApiTraining: true });
		await addKeyRule("allow_models", {
			models: ["approved/test-model", "unattested/test-model"],
		});
		for (const query of ["", "?mapped=true&no_training=true"]) {
			expect((await list(query)).map((model) => model.id)).toEqual([
				"approved/test-model",
			]);
		}
		await addKeyRule("deny_providers", { providers: ["custom:approved"] });
		expect(await list()).toEqual([]);
	});

	test("credits projects cannot discover custom models", async () => {
		await seedCustomModels();
		await harness.setProjectMode("credits");
		expect(
			(await list()).some((model) => model.id.includes("test-model")),
		).toBe(false);
	});

	test("DevPass discovery respects coding eligibility and disallows pinned IDs", async () => {
		await harness.setDevPlan({ devPlan: "pro" });
		await setPolicy({
			enabled: true,
			allowedModels: ["gpt-4o-mini", "text-embedding-3-small"],
			allowedProviders: ["openai"],
		});
		expect((await list()).map((model) => model.id)).toEqual(["gpt-4o-mini"]);
		expect(await list("?mapped=true")).toEqual([]);
	});
});
