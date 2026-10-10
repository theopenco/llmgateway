import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, invalidateOrganizationsCache, tables } from "@llmgateway/db";
import {
	isProviderAccessRestrictionEmpty,
	models,
	parseProviderAccessMappingRef,
	PROVIDER_ACCESS_RESTRICTION_MODES,
	providerAccessMappingRef,
	providers,
	type ModelDefinition,
	type ProviderAccessRestriction,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const adminProviderAccess = new OpenAPIHono<ServerTypes>();

adminProviderAccess.use("/*", adminMiddleware);

const MAX_ENTRIES = 1000;

const entryListSchema = z
	.array(z.string().trim().min(1).max(300))
	.max(MAX_ENTRIES);

const restrictionSchema = z.object({
	mode: z.enum(PROVIDER_ACCESS_RESTRICTION_MODES),
	providers: entryListSchema,
	models: entryListSchema,
	mappings: entryListSchema,
	note: z.string().trim().max(1000).optional(),
});

const optionsSchema = z.object({
	providers: z.array(z.object({ id: z.string(), name: z.string() })),
	models: z.array(z.object({ id: z.string(), name: z.string() })),
	mappings: z.array(z.object({ providerId: z.string(), modelId: z.string() })),
});

const responseSchema = z.object({
	restriction: restrictionSchema.nullable(),
	options: optionsSchema,
});

type AccessOptions = z.infer<typeof optionsSchema>;

/**
 * Every provider, model and provider mapping an admin can reference: the
 * static catalogue plus database rows, which also hold Airside listings.
 */
async function loadAccessOptions(): Promise<AccessOptions> {
	const [dbProviders, dbModels, dbMappings] = await Promise.all([
		db
			.select({ id: tables.provider.id, name: tables.provider.name })
			.from(tables.provider),
		db
			.select({ id: tables.model.id, name: tables.model.name })
			.from(tables.model),
		db
			.selectDistinct({
				providerId: tables.modelProviderMapping.providerId,
				modelId: tables.modelProviderMapping.modelId,
			})
			.from(tables.modelProviderMapping),
	]);

	const providerNames = new Map<string, string>();
	for (const provider of [...providers, ...dbProviders]) {
		if (!providerNames.has(provider.id)) {
			providerNames.set(provider.id, provider.name);
		}
	}
	const modelNames = new Map<string, string>();
	const mappings = new Map<string, { providerId: string; modelId: string }>();
	const addMapping = (providerId: string, modelId: string) => {
		mappings.set(providerAccessMappingRef(providerId, modelId), {
			providerId,
			modelId,
		});
	};
	const catalogue: readonly ModelDefinition[] = models;
	for (const model of catalogue) {
		modelNames.set(model.id, model.name ?? model.id);
		for (const mapping of model.providers) {
			addMapping(mapping.providerId, model.id);
		}
	}
	for (const model of dbModels) {
		if (!modelNames.has(model.id)) {
			modelNames.set(model.id, model.name);
		}
	}
	for (const mapping of dbMappings) {
		addMapping(mapping.providerId, mapping.modelId);
	}

	const byId = (a: { id: string }, b: { id: string }) =>
		a.id.localeCompare(b.id);
	return {
		providers: Array.from(providerNames, ([id, name]) => ({ id, name })).sort(
			byId,
		),
		models: Array.from(modelNames, ([id, name]) => ({ id, name })).sort(byId),
		mappings: Array.from(mappings.values()).sort((a, b) =>
			providerAccessMappingRef(a.providerId, a.modelId).localeCompare(
				providerAccessMappingRef(b.providerId, b.modelId),
			),
		),
	};
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/** Normalizes a submitted restriction and rejects entries no catalogue row backs. */
function normalizeRestriction(
	input: z.infer<typeof restrictionSchema>,
	options: AccessOptions,
): ProviderAccessRestriction {
	const restriction: ProviderAccessRestriction = {
		mode: input.mode,
		providers: uniqueSorted(input.providers),
		models: uniqueSorted(input.models),
		mappings: uniqueSorted(input.mappings),
		...(input.note ? { note: input.note } : {}),
	};

	const providerIds = new Set(options.providers.map((p) => p.id));
	const modelIds = new Set(options.models.map((m) => m.id));
	const mappingRefs = new Set(
		options.mappings.map((m) =>
			providerAccessMappingRef(m.providerId, m.modelId),
		),
	);
	const unknown = [
		...restriction.providers
			.filter((id) => !providerIds.has(id))
			.map((id) => `provider "${id}"`),
		...restriction.models
			.filter((id) => !modelIds.has(id))
			.map((id) => `model "${id}"`),
		...restriction.mappings
			.filter(
				(ref) => !parseProviderAccessMappingRef(ref) || !mappingRefs.has(ref),
			)
			.map((ref) => `mapping "${ref}"`),
	];
	if (unknown.length > 0) {
		throw new HTTPException(400, {
			message: `Unknown ${unknown.slice(0, 10).join(", ")}`,
		});
	}
	if (isProviderAccessRestrictionEmpty(restriction)) {
		throw new HTTPException(400, {
			message:
				"Add at least one provider, model or mapping, or remove the restriction",
		});
	}
	return restriction;
}

async function requireOrganization(orgId: string) {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});
	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	return org;
}

const getProviderAccess = createRoute({
	method: "get",
	path: "/organizations/{orgId}/provider-access",
	request: {
		params: z.object({ orgId: z.string() }),
	},
	responses: {
		200: {
			content: { "application/json": { schema: responseSchema } },
			description:
				"The organization's provider access restriction and the providers, models and mappings it can reference.",
		},
		404: { description: "Organization not found." },
	},
});

adminProviderAccess.openapi(getProviderAccess, async (c) => {
	const { orgId } = c.req.valid("param");
	const [org, options] = await Promise.all([
		requireOrganization(orgId),
		loadAccessOptions(),
	]);
	return c.json({
		restriction: org.providerAccessRestriction ?? null,
		options,
	});
});

const updateProviderAccess = createRoute({
	method: "put",
	path: "/organizations/{orgId}/provider-access",
	request: {
		params: z.object({ orgId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ restriction: restrictionSchema.nullable() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ restriction: restrictionSchema.nullable() }),
				},
			},
			description: "Provider access restriction updated.",
		},
		400: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "The restriction references unknown entries or is empty.",
		},
		404: { description: "Organization not found." },
	},
});

adminProviderAccess.openapi(updateProviderAccess, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { restriction: input } = c.req.valid("json");

	const org = await requireOrganization(orgId);
	const restriction = input
		? normalizeRestriction(input, await loadAccessOptions())
		: null;

	await db
		.update(tables.organization)
		.set({ providerAccessRestriction: restriction })
		.where(eq(tables.organization.id, orgId));
	await invalidateOrganizationsCache([orgId]);

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "organization.provider_access_update",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			resourceName: org.name,
			changes: {
				providerAccessRestriction: {
					old: org.providerAccessRestriction ?? null,
					new: restriction,
				},
			},
		},
	});

	return c.json({ restriction });
});
