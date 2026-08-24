import { afterEach, describe, expect, it } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { checkGuardrails } from "./engine.js";

const createdOrgIds: string[] = [];

interface ScopeOptions {
	orgEnabled?: boolean;
	orgTerm?: string;
	projectTerm?: string;
	inheritOrganization?: boolean;
	projectEnabled?: boolean;
	withProjectConfig?: boolean;
}

// Unique ids per case so the cached read layer cannot serve another case's rows.
let counter = 0;

async function seedScope(options: ScopeOptions) {
	counter += 1;
	const suffix = `scope-${counter}`;
	const organizationId = `org-${suffix}`;
	const projectId = `project-${suffix}`;
	createdOrgIds.push(organizationId);

	await db.insert(tables.organization).values({
		id: organizationId,
		name: `Org ${suffix}`,
		billingEmail: `${suffix}@example.com`,
		plan: "enterprise",
	});

	await db.insert(tables.project).values({
		id: projectId,
		name: `Project ${suffix}`,
		organizationId,
	});

	await db.insert(tables.guardrailConfig).values({
		organizationId,
		enabled: options.orgEnabled ?? true,
	});

	await db.insert(tables.guardrailRule).values({
		organizationId,
		name: "Org rule",
		type: "blocked_terms",
		config: {
			type: "blocked_terms",
			terms: [options.orgTerm ?? "orgsecret"],
			matchType: "contains",
			caseSensitive: false,
		},
		action: "block",
	});

	if (options.withProjectConfig) {
		await db.insert(tables.guardrailConfig).values({
			organizationId,
			projectId,
			inheritOrganization: options.inheritOrganization ?? true,
			enabled: options.projectEnabled ?? true,
		});

		await db.insert(tables.guardrailRule).values({
			organizationId,
			projectId,
			name: "Project rule",
			type: "blocked_terms",
			config: {
				type: "blocked_terms",
				terms: [options.projectTerm ?? "projectsecret"],
				matchType: "contains",
				caseSensitive: false,
			},
			action: "block",
		});
	}

	return { organizationId, projectId };
}

describe("guardrail scope resolution", () => {
	afterEach(async () => {
		for (const organizationId of createdOrgIds.splice(0)) {
			await db
				.delete(tables.organization)
				.where(eq(tables.organization.id, organizationId));
		}
	});

	it("applies the organization config when the project has no config", async () => {
		const { organizationId, projectId } = await seedScope({});

		const result = await checkGuardrails({
			organizationId,
			projectId,
			messages: [{ role: "user", content: "this mentions orgsecret" }],
		});

		expect(result.blocked).toBe(true);
	});

	it("applies the organization config while the project inherits", async () => {
		const { organizationId, projectId } = await seedScope({
			withProjectConfig: true,
			inheritOrganization: true,
		});

		const inherited = await checkGuardrails({
			organizationId,
			projectId,
			messages: [{ role: "user", content: "this mentions orgsecret" }],
		});
		expect(inherited.blocked).toBe(true);

		// The project's own rules are dormant while it inherits.
		const dormant = await checkGuardrails({
			organizationId,
			projectId,
			messages: [{ role: "user", content: "this mentions projectsecret" }],
		});
		expect(dormant.blocked).toBe(false);
	});

	it("replaces the organization config once the project overrides", async () => {
		const { organizationId, projectId } = await seedScope({
			withProjectConfig: true,
			inheritOrganization: false,
		});

		const projectRule = await checkGuardrails({
			organizationId,
			projectId,
			messages: [{ role: "user", content: "this mentions projectsecret" }],
		});
		expect(projectRule.blocked).toBe(true);

		const orgRule = await checkGuardrails({
			organizationId,
			projectId,
			messages: [{ role: "user", content: "this mentions orgsecret" }],
		});
		expect(orgRule.blocked).toBe(false);
	});

	it("lets an overriding project turn guardrails off entirely", async () => {
		const { organizationId, projectId } = await seedScope({
			withProjectConfig: true,
			inheritOrganization: false,
			projectEnabled: false,
		});

		const result = await checkGuardrails({
			organizationId,
			projectId,
			messages: [{ role: "user", content: "orgsecret and projectsecret" }],
		});

		expect(result.blocked).toBe(false);
		expect(result.rulesChecked).toBe(0);
	});

	it("ignores project rows when resolving the organization scope", async () => {
		const { organizationId } = await seedScope({
			withProjectConfig: true,
			inheritOrganization: false,
		});

		const result = await checkGuardrails({
			organizationId,
			messages: [{ role: "user", content: "this mentions projectsecret" }],
		});

		expect(result.blocked).toBe(false);
	});
});
