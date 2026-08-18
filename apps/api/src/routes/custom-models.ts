import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { assertOrganizationProviderKey } from "@/lib/organization-provider-key.js";
import {
	getActiveUserOrganizationIds,
	getAdminOrganizationIds,
} from "@/utils/authorization.js";

import { logAuditEvent } from "@llmgateway/audit";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";

export const customModels = new OpenAPIHono<ServerTypes>();

// The gateway reads custom models through a cached select (cdb) wrapped in an
// SWR fallback mirror, both keyed on the custom_model table. Mutations below
// write through cdb so its onMutate busts both layers; otherwise the gateway
// can serve stale pricing/limits/rejections until the cache expires.

const priceField = z
	.string()
	.refine(
		(v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
		{
			message: "Price must be a non-negative number",
		},
	)
	.nullish();

export const customModelSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	providerKeyId: z.string(),
	organizationId: z.string(),
	modelName: z.string(),
	displayName: z.string().nullable(),
	contextSize: z.number().nullable(),
	maxOutput: z.number().nullable(),
	inputPrice: z.string().nullable(),
	outputPrice: z.string().nullable(),
	cachedInputPrice: z.string().nullable(),
	cacheReadInputPrice: z.string().nullable(),
	cacheWriteInputPrice: z.string().nullable(),
	cacheWriteInputPrice1h: z.string().nullable(),
	requestPrice: z.string().nullable(),
	webSearchPrice: z.string().nullable(),
	imageInputPrice: z.string().nullable(),
	audioInputPrice: z.string().nullable(),
	streaming: z.enum(["true", "false", "only"]).nullable(),
	vision: z.boolean().nullable(),
	tools: z.boolean().nullable(),
	reasoning: z.boolean().nullable(),
	jsonOutput: z.boolean().nullable(),
	audio: z.boolean().nullable(),
	supportedParameters: z.array(z.string()).nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
});

// Writable fields shared by create and update. Prices are kept as strings to
// preserve the catalog's exponent-string format (e.g. "3.0e-6").
const customModelFields = {
	modelName: z
		.string()
		.min(1, "Model name is required")
		.regex(/^[\w.:/-]+$/, "Model name contains invalid characters"),
	displayName: z.string().nullish(),
	contextSize: z.number().int().positive().nullish(),
	maxOutput: z.number().int().positive().nullish(),
	inputPrice: priceField,
	outputPrice: priceField,
	cachedInputPrice: priceField,
	cacheReadInputPrice: priceField,
	cacheWriteInputPrice: priceField,
	cacheWriteInputPrice1h: priceField,
	requestPrice: priceField,
	webSearchPrice: priceField,
	imageInputPrice: priceField,
	audioInputPrice: priceField,
	streaming: z.enum(["true", "false", "only"]).nullish(),
	vision: z.boolean().nullish(),
	tools: z.boolean().nullish(),
	reasoning: z.boolean().nullish(),
	jsonOutput: z.boolean().nullish(),
	audio: z.boolean().nullish(),
	supportedParameters: z.array(z.string()).nullish(),
	status: z.enum(["active", "inactive"]).optional(),
};

export const createCustomModelSchema = z.object({
	providerKeyId: z.string().min(1, "Provider key is required"),
	...customModelFields,
});

export const updateCustomModelSchema = z
	.object({
		...customModelFields,
		modelName: customModelFields.modelName.optional(),
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: "No updatable fields provided",
	});

type CustomModelCreateFields = Omit<
	z.infer<typeof createCustomModelSchema>,
	"providerKeyId"
>;
type CustomModelUpdateFields = z.infer<typeof updateCustomModelSchema>;

interface CustomModelOwner {
	id: string;
	organizationId: string;
}

interface ExistingCustomModel {
	id: string;
	organizationId: string;
	providerKeyId: string;
	modelName: string;
}

async function assertModelNameAvailable(
	providerKeyId: string,
	modelName: string,
) {
	const conflict = await db.query.customModel.findFirst({
		where: {
			providerKeyId: { eq: providerKeyId },
			modelName: { eq: modelName },
			status: { ne: "deleted" },
		},
	});

	if (conflict) {
		throw new HTTPException(400, {
			message: `A custom model named '${modelName}' already exists for this provider key`,
		});
	}
}

/**
 * Create/update/delete helpers shared by the dashboard routes below and the
 * master-key API (`v1-master.ts`), so both surfaces apply the same uniqueness
 * checks, cache busting and audit logging. Callers are responsible for
 * authorizing the acting principal against the provider key first.
 */
export async function insertCustomModel(
	providerKey: CustomModelOwner,
	userId: string,
	fields: CustomModelCreateFields,
) {
	await assertModelNameAvailable(providerKey.id, fields.modelName);

	const [customModel] = await cdb
		.insert(tables.customModel)
		.values({
			providerKeyId: providerKey.id,
			organizationId: providerKey.organizationId,
			...fields,
		})
		.returning();

	await logAuditEvent({
		organizationId: providerKey.organizationId,
		userId,
		action: "custom_model.create",
		resourceType: "custom_model",
		resourceId: customModel.id,
		metadata: {
			providerKeyId: providerKey.id,
			modelName: fields.modelName,
		},
	});

	return customModel;
}

export async function applyCustomModelUpdate(
	existing: ExistingCustomModel,
	userId: string,
	fields: CustomModelUpdateFields,
) {
	if (fields.modelName && fields.modelName !== existing.modelName) {
		await assertModelNameAvailable(existing.providerKeyId, fields.modelName);
	}

	const [customModel] = await cdb
		.update(tables.customModel)
		.set(fields)
		.where(eq(tables.customModel.id, existing.id))
		.returning();

	await logAuditEvent({
		organizationId: existing.organizationId,
		userId,
		action: "custom_model.update",
		resourceType: "custom_model",
		resourceId: existing.id,
		metadata: {
			providerKeyId: existing.providerKeyId,
			modelName: customModel.modelName,
		},
	});

	return customModel;
}

export async function softDeleteCustomModel(
	existing: ExistingCustomModel,
	userId: string,
) {
	await cdb
		.update(tables.customModel)
		.set({ status: "deleted" })
		.where(eq(tables.customModel.id, existing.id));

	await logAuditEvent({
		organizationId: existing.organizationId,
		userId,
		action: "custom_model.delete",
		resourceType: "custom_model",
		resourceId: existing.id,
		metadata: {
			providerKeyId: existing.providerKeyId,
			modelName: existing.modelName,
		},
	});
}

/**
 * Resolves a custom provider key the user can manage and asserts that the
 * owning org has an enterprise plan. Custom models are an enterprise feature;
 * the gateway honors stored catalog rows regardless of plan, but management is
 * gated here.
 */
async function getManageableProviderKey(userId: string, providerKeyId: string) {
	const organizationIds = await getAdminOrganizationIds(userId);

	const providerKey = await db.query.providerKey.findFirst({
		where: {
			id: { eq: providerKeyId },
			organizationId: { in: organizationIds },
			status: { ne: "deleted" },
		},
		with: {
			organization: true,
		},
	});

	if (!providerKey) {
		throw new HTTPException(404, {
			message: "Provider key not found",
		});
	}

	assertOrganizationProviderKey(providerKey);

	if (providerKey.provider !== "custom") {
		throw new HTTPException(400, {
			message: "Custom models can only be defined for custom provider keys",
		});
	}

	if (
		!hasOrganizationEnterpriseAccess(
			providerKey.organization?.id,
			providerKey.organization?.plan,
		)
	) {
		throw new HTTPException(403, {
			message: "Custom models require an enterprise plan",
		});
	}

	return providerKey;
}

// List custom models for the user's organizations (optionally by provider key)
const list = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			providerKeyId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customModels: z.array(customModelSchema).openapi({}),
					}),
				},
			},
			description: "List of custom models.",
		},
	},
});

customModels.openapi(list, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { providerKeyId } = c.req.valid("query");

	// Reads are member-level so every org member (including project-scoped
	// developers) can browse the custom-model catalog; create/update/delete
	// stay owner/admin-gated via getManageableProviderKey.
	const organizationIds = await getActiveUserOrganizationIds(user.id);
	if (!organizationIds.length) {
		return c.json({ customModels: [] });
	}

	const rows = await db.query.customModel.findMany({
		where: {
			organizationId: { in: organizationIds },
			status: { ne: "deleted" },
			...(providerKeyId ? { providerKeyId: { eq: providerKeyId } } : {}),
		},
		orderBy: {
			createdAt: "asc",
		},
	});

	return c.json({ customModels: rows });
});

// Create a custom model
const create = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createCustomModelSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customModel: customModelSchema.openapi({}),
					}),
				},
			},
			description: "Custom model created successfully.",
		},
	},
});

customModels.openapi(create, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { providerKeyId, ...fields } = c.req.valid("json");

	const providerKey = await getManageableProviderKey(user.id, providerKeyId);

	const customModel = await insertCustomModel(providerKey, user.id, fields);

	return c.json({ customModel });
});

// Update a custom model
const update = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateCustomModelSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customModel: customModelSchema.openapi({}),
					}),
				},
			},
			description: "Custom model updated successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Custom model not found.",
		},
	},
});

customModels.openapi(update, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const fields = c.req.valid("json");

	const organizationIds = await getAdminOrganizationIds(user.id);
	const existing = await db.query.customModel.findFirst({
		where: {
			id: { eq: id },
			organizationId: { in: organizationIds },
			status: { ne: "deleted" },
		},
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Custom model not found" });
	}

	// Enforce enterprise plan + custom provider key ownership.
	await getManageableProviderKey(user.id, existing.providerKeyId);

	const customModel = await applyCustomModelUpdate(existing, user.id, fields);

	return c.json({ customModel }, 200);
});

// Soft-delete a custom model
const deleteCustomModel = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Custom model deleted successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Custom model not found.",
		},
	},
});

customModels.openapi(deleteCustomModel, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const organizationIds = await getAdminOrganizationIds(user.id);
	const existing = await db.query.customModel.findFirst({
		where: {
			id: { eq: id },
			organizationId: { in: organizationIds },
			status: { ne: "deleted" },
		},
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Custom model not found" });
	}

	await getManageableProviderKey(user.id, existing.providerKeyId);

	await softDeleteCustomModel(existing, user.id);

	return c.json({ message: "Custom model deleted successfully" });
});

export default customModels;
