import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { claimableProvidersForEmail } from "@/lib/airside-domains.js";

import { and, db, desc, eq, gte, inArray, sql, tables } from "@llmgateway/db";
import { providers as catalogueProviders } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

/**
 * Airside — the self-serve provider portal. Provider companies ("carriers")
 * claim catalogue providers by verified email domain, list models whose
 * pricing only changes through admin-approved filings, watch usage of their
 * providers, and tune the routing knobs (traffic discount + accepted gateway
 * margin) that feed the routing election.
 */

export const airside = new OpenAPIHono<ServerTypes>();

// The gateway's standard margin. A carrier accepting a larger margin or
// offering a discount is boosted in routing (and vice versa) — see
// syncRoutingScoreMultiplier below.
export const AIRSIDE_BASELINE_MARGIN = 0.2;
export const AIRSIDE_MARGIN_MIN = 0.05;
export const AIRSIDE_MARGIN_MAX = 0.5;
export const AIRSIDE_DISCOUNT_MAX = 0.5;
const AIRSIDE_MULTIPLIER_REASON = "airside routing settings";

const priceValue = z
	.string()
	.refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
		message: "Price must be a non-negative number string",
	});

const pricingSchema = z.object({
	inputPrice: priceValue,
	outputPrice: priceValue,
	cachedInputPrice: priceValue.optional(),
	requestPrice: priceValue.optional(),
});

const claimSchema = z.object({
	id: z.string(),
	providerCompanyId: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	matchedDomain: z.string(),
	status: z.enum(["active", "revoked"]),
	createdAt: z.string(),
});

const companySchema = z.object({
	id: z.string(),
	name: z.string(),
	website: z.string().nullable(),
	role: z.enum(["owner", "member"]),
	createdAt: z.string(),
	claims: z.array(claimSchema),
});

const filingSchema = z.object({
	id: z.string(),
	draftModelId: z.string(),
	providerCompanyId: z.string(),
	kind: z.enum(["initial", "update"]),
	inputPrice: z.string(),
	outputPrice: z.string(),
	cachedInputPrice: z.string().nullable(),
	requestPrice: z.string().nullable(),
	status: z.enum(["pending", "approved", "rejected"]),
	note: z.string().nullable(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
});

const modelSchema = z.object({
	id: z.string(),
	providerCompanyId: z.string(),
	providerId: z.string(),
	modelName: z.string(),
	displayName: z.string().nullable(),
	description: z.string().nullable(),
	family: z.string().nullable(),
	contextSize: z.number().nullable(),
	maxOutput: z.number().nullable(),
	streaming: z.boolean(),
	vision: z.boolean(),
	tools: z.boolean(),
	jsonOutput: z.boolean(),
	reasoning: z.boolean(),
	status: z.enum(["draft", "active", "rejected", "delisted"]),
	createdAt: z.string(),
	updatedAt: z.string(),
	currentPricing: filingSchema.nullable(),
	pendingFiling: filingSchema.nullable(),
});

const routingSettingsSchema = z.object({
	providerId: z.string(),
	providerCompanyId: z.string(),
	discountPercent: z.number(),
	marginPercent: z.number(),
	// The signed routing-price adjustment currently applied for this provider
	// (negative = boosted, i.e. routed as if cheaper).
	routingAdjustment: z.number(),
	updatedAt: z.string().nullable(),
});

type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;
type PriceFilingRow = typeof tables.providerPriceFiling.$inferSelect;
type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;

function serializeClaim(
	row: ProviderClaimRow,
	providerNames: Map<string, string>,
) {
	return {
		id: row.id,
		providerCompanyId: row.providerCompanyId,
		providerId: row.providerId,
		providerName: providerNames.get(row.providerId) ?? row.providerId,
		matchedDomain: row.matchedDomain,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
	};
}

function serializeFiling(row: PriceFilingRow) {
	return {
		id: row.id,
		draftModelId: row.draftModelId,
		providerCompanyId: row.providerCompanyId,
		kind: row.kind,
		inputPrice: row.inputPrice,
		outputPrice: row.outputPrice,
		cachedInputPrice: row.cachedInputPrice,
		requestPrice: row.requestPrice,
		status: row.status,
		note: row.note,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	};
}

function serializeModel(
	row: DraftModelRow & { priceFilings?: PriceFilingRow[] },
) {
	const filings = [...(row.priceFilings ?? [])].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
	);
	const approved = filings.find((f) => f.status === "approved");
	const pending = filings.find((f) => f.status === "pending");
	return {
		id: row.id,
		providerCompanyId: row.providerCompanyId,
		providerId: row.providerId,
		modelName: row.modelName,
		displayName: row.displayName,
		description: row.description,
		family: row.family,
		contextSize: row.contextSize,
		maxOutput: row.maxOutput,
		streaming: row.streaming,
		vision: row.vision,
		tools: row.tools,
		jsonOutput: row.jsonOutput,
		reasoning: row.reasoning,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		currentPricing: approved ? serializeFiling(approved) : null,
		pendingFiling: pending ? serializeFiling(pending) : null,
	};
}

interface SessionUserLike {
	id: string;
	email: string;
	emailVerified: boolean;
}

function requireUser(user: SessionUserLike | null): SessionUserLike {
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	return user;
}

function requireVerifiedUser(user: SessionUserLike | null): SessionUserLike {
	const resolved = requireUser(user);
	if (!resolved.emailVerified) {
		throw new HTTPException(403, {
			message: "Verify your email address before performing this action.",
		});
	}
	return resolved;
}

async function requireCompanyMembership(
	userId: string,
	providerCompanyId: string,
) {
	const membership = await db.query.providerCompanyMember.findFirst({
		where: {
			providerCompanyId: { eq: providerCompanyId },
			userId: { eq: userId },
		},
	});
	if (!membership) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	return membership;
}

async function getActiveClaimedProviderIds(
	providerCompanyId: string,
): Promise<string[]> {
	const claims = await db.query.providerClaim.findMany({
		where: {
			providerCompanyId: { eq: providerCompanyId },
			status: { eq: "active" },
		},
	});
	return claims.map((claim) => claim.providerId);
}

const providerNamesById = new Map(
	catalogueProviders.map((p) => [p.id, p.name]),
);

function clampAdjustment(value: number): number {
	const clamped = Math.min(0.9, Math.max(-0.9, value));
	// Round away float artifacts (0.15 - 0.2 - 0.05 !== -0.1 in IEEE754).
	return Math.round(clamped * 10000) / 10000;
}

/**
 * Mirror a carrier's routing settings into `routing_score_multiplier` so the
 * routing election prices the provider up or down. Airside only ever touches
 * provider-wide rows it created itself (matched on `reason`); an admin-set
 * multiplier for the same provider always wins and is left alone.
 */
async function syncRoutingScoreMultiplier(
	providerId: string,
	discountPercent: number,
	marginPercent: number,
) {
	const adjustment = clampAdjustment(
		marginPercent - AIRSIDE_BASELINE_MARGIN - discountPercent,
	);
	const existing = await db.query.routingScoreMultiplier.findFirst({
		where: { provider: { eq: providerId }, model: { isNull: true } },
	});
	if (existing && existing.reason !== AIRSIDE_MULTIPLIER_REASON) {
		return adjustment;
	}
	if (adjustment === 0) {
		if (existing) {
			await db
				.delete(tables.routingScoreMultiplier)
				.where(eq(tables.routingScoreMultiplier.id, existing.id));
		}
		return adjustment;
	}
	if (existing) {
		await db
			.update(tables.routingScoreMultiplier)
			.set({ scoreMultiplier: String(adjustment) })
			.where(eq(tables.routingScoreMultiplier.id, existing.id));
	} else {
		await db.insert(tables.routingScoreMultiplier).values({
			provider: providerId,
			model: null,
			scoreMultiplier: String(adjustment),
			reason: AIRSIDE_MULTIPLIER_REASON,
		});
	}
	return adjustment;
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const listCompanies = createRoute({
	method: "get",
	path: "/companies",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ companies: z.array(companySchema) }),
				},
			},
			description: "Provider companies the user belongs to.",
		},
	},
});

airside.openapi(listCompanies, async (c) => {
	const user = requireUser(c.get("user"));
	const memberships = await db.query.providerCompanyMember.findMany({
		where: { userId: { eq: user.id } },
		with: { providerCompany: { with: { claims: true } } },
		orderBy: { createdAt: "asc" },
	});
	const providerNames = providerNamesById;
	return c.json({
		companies: memberships.flatMap((m) => {
			const company = m.providerCompany;
			if (!company) {
				return [];
			}
			return [
				{
					id: company.id,
					name: company.name,
					website: company.website,
					role: m.role,
					createdAt: company.createdAt.toISOString(),
					claims: company.claims
						.filter((claim) => claim.status === "active")
						.map((claim) => serializeClaim(claim, providerNames)),
				},
			];
		}),
	});
});

const createCompany = createRoute({
	method: "post",
	path: "/companies",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(2).max(100),
						website: z.string().url().optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ company: companySchema }),
				},
			},
			description: "The created provider company.",
		},
	},
});

airside.openapi(createCompany, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { name, website } = c.req.valid("json");
	const company = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(tables.providerCompany)
			.values({ name, website: website ?? null })
			.returning();
		await tx.insert(tables.providerCompanyMember).values({
			providerCompanyId: created.id,
			userId: user.id,
			role: "owner",
		});
		return created;
	});
	return c.json(
		{
			company: {
				id: company.id,
				name: company.name,
				website: company.website,
				role: "owner" as const,
				createdAt: company.createdAt.toISOString(),
				claims: [],
			},
		},
		201,
	);
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const listClaimable = createRoute({
	method: "get",
	path: "/claimable",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						emailDomain: z.string().nullable(),
						emailVerified: z.boolean(),
						providers: z.array(
							z.object({
								providerId: z.string(),
								name: z.string(),
								matchedDomain: z.string(),
								claimed: z.boolean(),
								claimedByMyCompany: z.boolean(),
							}),
						),
					}),
				},
			},
			description:
				"Catalogue providers whose endpoint domain matches the user's email domain.",
		},
	},
});

airside.openapi(listClaimable, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const matches = claimableProvidersForEmail(user.email);
	const claims = matches.length
		? await db.query.providerClaim.findMany({
				where: {
					providerId: { in: matches.map((m) => m.providerId) },
					status: { eq: "active" },
				},
			})
		: [];
	const memberships = await db.query.providerCompanyMember.findMany({
		where: { userId: { eq: user.id } },
	});
	const myCompanyIds = new Set(memberships.map((m) => m.providerCompanyId));
	const claimByProvider = new Map(claims.map((cl) => [cl.providerId, cl]));
	return c.json({
		emailDomain: matches[0]?.matchedDomain ?? null,
		emailVerified: user.emailVerified,
		providers: matches.map((m) => {
			const existing = claimByProvider.get(m.providerId);
			return {
				providerId: m.providerId,
				name: m.name,
				matchedDomain: m.matchedDomain,
				claimed: !!existing,
				claimedByMyCompany: existing
					? myCompanyIds.has(existing.providerCompanyId)
					: false,
			};
		}),
	});
});

const createClaim = createRoute({
	method: "post",
	path: "/claims",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						providerId: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ claim: claimSchema }),
				},
			},
			description: "The created provider claim.",
		},
	},
});

airside.openapi(createClaim, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { providerCompanyId, providerId } = c.req.valid("json");
	await requireCompanyMembership(user.id, providerCompanyId);

	const match = claimableProvidersForEmail(user.email).find(
		(m) => m.providerId === providerId,
	);
	if (!match) {
		throw new HTTPException(403, {
			message:
				"Your email domain does not match this provider's API endpoint domain.",
		});
	}

	const existing = await db.query.providerClaim.findFirst({
		where: { providerId: { eq: providerId }, status: { eq: "active" } },
	});
	if (existing) {
		throw new HTTPException(409, {
			message: "This provider has already been claimed.",
		});
	}

	const claim = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(tables.providerClaim)
			.values({
				providerCompanyId,
				providerId,
				matchedDomain: match.matchedDomain,
				claimedBy: user.id,
			})
			.returning();
		const settings = await tx.query.providerRoutingSettings.findFirst({
			where: { providerId: { eq: providerId } },
		});
		if (!settings) {
			await tx.insert(tables.providerRoutingSettings).values({
				providerCompanyId,
				providerId,
			});
		}
		return created;
	});
	const providerNames = providerNamesById;
	return c.json({ claim: serializeClaim(claim, providerNames) }, 201);
});

// ---------------------------------------------------------------------------
// Models (fleet)
// ---------------------------------------------------------------------------

const listModels = createRoute({
	method: "get",
	path: "/models",
	request: {
		query: z.object({
			providerCompanyId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ models: z.array(modelSchema) }),
				},
			},
			description: "The company's listed models with pricing state.",
		},
	},
});

airside.openapi(listModels, async (c) => {
	const user = requireUser(c.get("user"));
	const { providerCompanyId } = c.req.valid("query");
	await requireCompanyMembership(user.id, providerCompanyId);
	const rows = await db.query.providerDraftModel.findMany({
		where: { providerCompanyId: { eq: providerCompanyId } },
		with: { priceFilings: true },
		orderBy: { createdAt: "desc" },
	});
	return c.json({ models: rows.map(serializeModel) });
});

const createModel = createRoute({
	method: "post",
	path: "/models",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						providerId: z.string(),
						modelName: z.string().min(1).max(200),
						displayName: z.string().max(200).optional(),
						description: z.string().max(2000).optional(),
						family: z.string().max(100).optional(),
						contextSize: z.number().int().positive().optional(),
						maxOutput: z.number().int().positive().optional(),
						streaming: z.boolean().optional(),
						vision: z.boolean().optional(),
						tools: z.boolean().optional(),
						jsonOutput: z.boolean().optional(),
						reasoning: z.boolean().optional(),
						pricing: pricingSchema,
						note: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ model: modelSchema }),
				},
			},
			description:
				"The drafted model. It activates once its initial price filing is approved.",
		},
	},
});

airside.openapi(createModel, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const body = c.req.valid("json");
	await requireCompanyMembership(user.id, body.providerCompanyId);

	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: body.providerCompanyId },
			providerId: { eq: body.providerId },
			status: { eq: "active" },
		},
	});
	if (!claim) {
		throw new HTTPException(403, {
			message: "This provider is not claimed by the company.",
		});
	}

	const duplicate = await db.query.providerDraftModel.findFirst({
		where: {
			providerId: { eq: body.providerId },
			modelName: { eq: body.modelName },
			status: { ne: "delisted" },
		},
	});
	if (duplicate) {
		throw new HTTPException(409, {
			message: "A model with this name is already listed for the provider.",
		});
	}

	const created = await db.transaction(async (tx) => {
		const [model] = await tx
			.insert(tables.providerDraftModel)
			.values({
				providerCompanyId: body.providerCompanyId,
				providerId: body.providerId,
				modelName: body.modelName,
				displayName: body.displayName ?? null,
				description: body.description ?? null,
				family: body.family ?? null,
				contextSize: body.contextSize ?? null,
				maxOutput: body.maxOutput ?? null,
				streaming: body.streaming ?? true,
				vision: body.vision ?? false,
				tools: body.tools ?? false,
				jsonOutput: body.jsonOutput ?? false,
				reasoning: body.reasoning ?? false,
				createdBy: user.id,
			})
			.returning();
		const [filing] = await tx
			.insert(tables.providerPriceFiling)
			.values({
				draftModelId: model.id,
				providerCompanyId: body.providerCompanyId,
				kind: "initial",
				inputPrice: body.pricing.inputPrice,
				outputPrice: body.pricing.outputPrice,
				cachedInputPrice: body.pricing.cachedInputPrice ?? null,
				requestPrice: body.pricing.requestPrice ?? null,
				requestedBy: user.id,
				note: body.note ?? null,
			})
			.returning();
		return { ...model, priceFilings: [filing] };
	});

	return c.json({ model: serializeModel(created) }, 201);
});

const updateModel = createRoute({
	method: "patch",
	path: "/models/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						displayName: z.string().max(200).nullish(),
						description: z.string().max(2000).nullish(),
						family: z.string().max(100).nullish(),
						contextSize: z.number().int().positive().nullish(),
						maxOutput: z.number().int().positive().nullish(),
						streaming: z.boolean().optional(),
						vision: z.boolean().optional(),
						tools: z.boolean().optional(),
						jsonOutput: z.boolean().optional(),
						reasoning: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ model: modelSchema }),
				},
			},
			description:
				"The updated model. Pricing is not editable here — file a price change instead.",
		},
	},
});

airside.openapi(updateModel, async (c) => {
	const user = requireUser(c.get("user"));
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: id } },
	});
	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	await requireCompanyMembership(user.id, model.providerCompanyId);
	if (model.status === "delisted") {
		throw new HTTPException(409, {
			message: "Delisted models cannot be edited.",
		});
	}
	const [updated] = await db
		.update(tables.providerDraftModel)
		.set({
			...(body.displayName !== undefined
				? { displayName: body.displayName }
				: {}),
			...(body.description !== undefined
				? { description: body.description }
				: {}),
			...(body.family !== undefined ? { family: body.family } : {}),
			...(body.contextSize !== undefined
				? { contextSize: body.contextSize }
				: {}),
			...(body.maxOutput !== undefined ? { maxOutput: body.maxOutput } : {}),
			...(body.streaming !== undefined ? { streaming: body.streaming } : {}),
			...(body.vision !== undefined ? { vision: body.vision } : {}),
			...(body.tools !== undefined ? { tools: body.tools } : {}),
			...(body.jsonOutput !== undefined ? { jsonOutput: body.jsonOutput } : {}),
			...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
		})
		.where(eq(tables.providerDraftModel.id, id))
		.returning();
	const filings = await db.query.providerPriceFiling.findMany({
		where: { draftModelId: { eq: id } },
	});
	return c.json({
		model: serializeModel({ ...updated, priceFilings: filings }),
	});
});

const deleteModel = createRoute({
	method: "delete",
	path: "/models/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.enum(["deleted", "delisted"]),
					}),
				},
			},
			description:
				"Drafts are removed outright; active models are delisted instead.",
		},
	},
});

airside.openapi(deleteModel, async (c) => {
	const user = requireUser(c.get("user"));
	const { id } = c.req.valid("param");
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: id } },
	});
	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	await requireCompanyMembership(user.id, model.providerCompanyId);
	if (model.status === "draft" || model.status === "rejected") {
		await db
			.delete(tables.providerDraftModel)
			.where(eq(tables.providerDraftModel.id, id));
		return c.json({ status: "deleted" as const });
	}
	await db
		.update(tables.providerDraftModel)
		.set({ status: "delisted", delistedAt: new Date() })
		.where(eq(tables.providerDraftModel.id, id));
	return c.json({ status: "delisted" as const });
});

const createPriceFiling = createRoute({
	method: "post",
	path: "/models/{id}/price-filings",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: pricingSchema.extend({
						note: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ filing: filingSchema }),
				},
			},
			description: "The pending price filing awaiting admin approval.",
		},
	},
});

airside.openapi(createPriceFiling, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: id } },
	});
	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	await requireCompanyMembership(user.id, model.providerCompanyId);
	if (model.status === "delisted") {
		throw new HTTPException(409, {
			message: "Delisted models cannot receive price filings.",
		});
	}
	const pending = await db.query.providerPriceFiling.findFirst({
		where: { draftModelId: { eq: id }, status: { eq: "pending" } },
	});
	if (pending) {
		throw new HTTPException(409, {
			message: "A price filing for this model is already pending review.",
		});
	}
	const kind = model.status === "active" ? "update" : "initial";
	const filing = await db.transaction(async (tx) => {
		if (model.status === "rejected") {
			await tx
				.update(tables.providerDraftModel)
				.set({ status: "draft" })
				.where(eq(tables.providerDraftModel.id, id));
		}
		const [created] = await tx
			.insert(tables.providerPriceFiling)
			.values({
				draftModelId: id,
				providerCompanyId: model.providerCompanyId,
				kind,
				inputPrice: body.inputPrice,
				outputPrice: body.outputPrice,
				cachedInputPrice: body.cachedInputPrice ?? null,
				requestPrice: body.requestPrice ?? null,
				requestedBy: user.id,
				note: body.note ?? null,
			})
			.returning();
		return created;
	});
	return c.json({ filing: serializeFiling(filing) }, 201);
});

const listFilings = createRoute({
	method: "get",
	path: "/filings",
	request: {
		query: z.object({
			providerCompanyId: z.string(),
			status: z.enum(["pending", "approved", "rejected"]).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						filings: z.array(
							filingSchema.extend({
								modelName: z.string(),
								providerId: z.string(),
							}),
						),
					}),
				},
			},
			description: "Price filings for the company, newest first.",
		},
	},
});

airside.openapi(listFilings, async (c) => {
	const user = requireUser(c.get("user"));
	const { providerCompanyId, status } = c.req.valid("query");
	await requireCompanyMembership(user.id, providerCompanyId);
	const rows = await db.query.providerPriceFiling.findMany({
		where: {
			providerCompanyId: { eq: providerCompanyId },
			...(status ? { status: { eq: status } } : {}),
		},
		with: { draftModel: true },
		orderBy: { createdAt: "desc" },
		limit: 100,
	});
	return c.json({
		filings: rows.flatMap((row) =>
			row.draftModel
				? [
						{
							...serializeFiling(row),
							modelName: row.draftModel.modelName,
							providerId: row.draftModel.providerId,
						},
					]
				: [],
		),
	});
});

// ---------------------------------------------------------------------------
// Stats (traffic)
// ---------------------------------------------------------------------------

const statsRoute = createRoute({
	method: "get",
	path: "/stats",
	request: {
		query: z.object({
			providerCompanyId: z.string(),
			providerId: z.string().optional(),
			days: z.coerce.number().min(1).max(90).default(30).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						days: z.number(),
						providerIds: z.array(z.string()),
						totals: z.object({
							requestCount: z.number(),
							errorCount: z.number(),
							cacheCount: z.number(),
							inputTokens: z.number(),
							outputTokens: z.number(),
							totalTokens: z.number(),
							cost: z.number(),
							estimatedPayout: z.number(),
						}),
						byModel: z.array(
							z.object({
								providerId: z.string(),
								model: z.string(),
								requestCount: z.number(),
								errorCount: z.number(),
								inputTokens: z.number(),
								outputTokens: z.number(),
								cost: z.number(),
							}),
						),
						daily: z.array(
							z.object({
								day: z.string(),
								requestCount: z.number(),
								errorCount: z.number(),
								outputTokens: z.number(),
								cost: z.number(),
							}),
						),
					}),
				},
			},
			description:
				"Usage of the company's claimed providers, aggregated from hourly rollups.",
		},
	},
});

airside.openapi(statsRoute, async (c) => {
	const user = requireUser(c.get("user"));
	const query = c.req.valid("query");
	const days = query.days ?? 30;
	await requireCompanyMembership(user.id, query.providerCompanyId);
	let providerIds = await getActiveClaimedProviderIds(query.providerCompanyId);
	if (query.providerId) {
		providerIds = providerIds.filter((p) => p === query.providerId);
	}

	const emptyTotals = {
		requestCount: 0,
		errorCount: 0,
		cacheCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cost: 0,
		estimatedPayout: 0,
	};
	if (providerIds.length === 0) {
		return c.json({
			days,
			providerIds,
			totals: emptyTotals,
			byModel: [],
			daily: [],
		});
	}

	const mph = tables.projectHourlyModelStats;
	const windowMs = days * 86_400_000;
	const since = new Date(Date.now() - windowMs);
	since.setMinutes(0, 0, 0);
	const whereClause = and(
		inArray(mph.usedProvider, providerIds),
		gte(mph.hourTimestamp, since),
	);

	const [totalsRow] = await db
		.select({
			requestCount: sql<number>`COALESCE(SUM(${mph.requestCount}), 0)::int`,
			errorCount: sql<number>`COALESCE(SUM(${mph.errorCount}), 0)::int`,
			cacheCount: sql<number>`COALESCE(SUM(${mph.cacheCount}), 0)::int`,
			inputTokens: sql<number>`COALESCE(SUM(${mph.inputTokens}), 0)::float8`,
			outputTokens: sql<number>`COALESCE(SUM(${mph.outputTokens}), 0)::float8`,
			totalTokens: sql<number>`COALESCE(SUM(${mph.totalTokens}), 0)::float8`,
			cost: sql<number>`COALESCE(SUM(${mph.cost}), 0)::float8`,
		})
		.from(mph)
		.where(whereClause);

	const settingsRows = await db.query.providerRoutingSettings.findMany({
		where: { providerId: { in: providerIds } },
	});
	const marginByProvider = new Map(
		settingsRows.map((s) => [s.providerId, Number(s.marginPercent)]),
	);

	const byModelRows = await db
		.select({
			providerId: mph.usedProvider,
			model: mph.usedModel,
			requestCount: sql<number>`SUM(${mph.requestCount})::int`,
			errorCount: sql<number>`SUM(${mph.errorCount})::int`,
			inputTokens: sql<number>`SUM(${mph.inputTokens})::float8`,
			outputTokens: sql<number>`SUM(${mph.outputTokens})::float8`,
			cost: sql<number>`SUM(${mph.cost})::float8`,
		})
		.from(mph)
		.where(whereClause)
		.groupBy(mph.usedProvider, mph.usedModel)
		.orderBy(desc(sql`SUM(${mph.cost})`));

	const dayExpr = sql<string>`date_trunc('day', ${mph.hourTimestamp})`;
	const dailyRows = await db
		.select({
			day: dayExpr,
			requestCount: sql<number>`SUM(${mph.requestCount})::int`,
			errorCount: sql<number>`SUM(${mph.errorCount})::int`,
			outputTokens: sql<number>`SUM(${mph.outputTokens})::float8`,
			cost: sql<number>`SUM(${mph.cost})::float8`,
		})
		.from(mph)
		.where(whereClause)
		.groupBy(dayExpr)
		.orderBy(dayExpr);

	const estimatedPayout = byModelRows.reduce((sum, row) => {
		const margin =
			marginByProvider.get(row.providerId) ?? AIRSIDE_BASELINE_MARGIN;
		const payout = row.cost * (1 - margin);
		return sum + payout;
	}, 0);

	return c.json({
		days,
		providerIds,
		totals: totalsRow
			? {
					requestCount: totalsRow.requestCount,
					errorCount: totalsRow.errorCount,
					cacheCount: totalsRow.cacheCount,
					inputTokens: totalsRow.inputTokens,
					outputTokens: totalsRow.outputTokens,
					totalTokens: totalsRow.totalTokens,
					cost: totalsRow.cost,
					estimatedPayout,
				}
			: emptyTotals,
		byModel: byModelRows,
		daily: dailyRows.map((row) => ({
			...row,
			day: new Date(row.day).toISOString(),
		})),
	});
});

// ---------------------------------------------------------------------------
// Routing settings (fares & landing fees)
// ---------------------------------------------------------------------------

const listRoutingSettings = createRoute({
	method: "get",
	path: "/routing-settings",
	request: {
		query: z.object({ providerCompanyId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						baselineMargin: z.number(),
						settings: z.array(routingSettingsSchema),
					}),
				},
			},
			description: "Routing knobs for each claimed provider.",
		},
	},
});

airside.openapi(listRoutingSettings, async (c) => {
	const user = requireUser(c.get("user"));
	const { providerCompanyId } = c.req.valid("query");
	await requireCompanyMembership(user.id, providerCompanyId);
	const providerIds = await getActiveClaimedProviderIds(providerCompanyId);
	const rows = providerIds.length
		? await db.query.providerRoutingSettings.findMany({
				where: { providerId: { in: providerIds } },
			})
		: [];
	const rowByProvider = new Map(rows.map((row) => [row.providerId, row]));
	return c.json({
		baselineMargin: AIRSIDE_BASELINE_MARGIN,
		settings: providerIds.map((providerId) => {
			const row = rowByProvider.get(providerId);
			const discountPercent = row ? Number(row.discountPercent) : 0;
			const marginPercent = row
				? Number(row.marginPercent)
				: AIRSIDE_BASELINE_MARGIN;
			return {
				providerId,
				providerCompanyId,
				discountPercent,
				marginPercent,
				routingAdjustment: clampAdjustment(
					marginPercent - AIRSIDE_BASELINE_MARGIN - discountPercent,
				),
				updatedAt: row ? row.updatedAt.toISOString() : null,
			};
		}),
	});
});

const updateRoutingSettings = createRoute({
	method: "put",
	path: "/routing-settings/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						discountPercent: z.number().min(0).max(AIRSIDE_DISCOUNT_MAX),
						marginPercent: z
							.number()
							.min(AIRSIDE_MARGIN_MIN)
							.max(AIRSIDE_MARGIN_MAX),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ settings: routingSettingsSchema }),
				},
			},
			description: "The updated routing settings.",
		},
	},
});

airside.openapi(updateRoutingSettings, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { providerId } = c.req.valid("param");
	const body = c.req.valid("json");
	await requireCompanyMembership(user.id, body.providerCompanyId);

	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: body.providerCompanyId },
			providerId: { eq: providerId },
			status: { eq: "active" },
		},
	});
	if (!claim) {
		throw new HTTPException(403, {
			message: "This provider is not claimed by the company.",
		});
	}

	const existing = await db.query.providerRoutingSettings.findFirst({
		where: { providerId: { eq: providerId } },
	});
	const values = {
		discountPercent: String(body.discountPercent),
		marginPercent: String(body.marginPercent),
	};
	const [row] = existing
		? await db
				.update(tables.providerRoutingSettings)
				.set(values)
				.where(eq(tables.providerRoutingSettings.id, existing.id))
				.returning()
		: await db
				.insert(tables.providerRoutingSettings)
				.values({
					providerCompanyId: body.providerCompanyId,
					providerId,
					...values,
				})
				.returning();

	const routingAdjustment = await syncRoutingScoreMultiplier(
		providerId,
		body.discountPercent,
		body.marginPercent,
	);

	return c.json({
		settings: {
			providerId,
			providerCompanyId: body.providerCompanyId,
			discountPercent: Number(row.discountPercent),
			marginPercent: Number(row.marginPercent),
			routingAdjustment,
			updatedAt: row.updatedAt.toISOString(),
		},
	});
});
