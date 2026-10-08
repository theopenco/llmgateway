import { randomBytes } from "node:crypto";

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	ICON_MAX_BYTES,
	imageDataUrl,
	LOGO_MAX_BYTES,
} from "@/lib/airside-branding.js";
import { discardPendingProviderKey } from "@/lib/airside-carrier-keys.js";
import {
	dematerializeAirsideModel,
	materializeAirsideModel,
	syncAirsideModelMetadata,
	updateAirsideMappingPrices,
} from "@/lib/airside-catalogue.js";
import {
	airsideModelMetadataSchema,
	type AirsideModelMetadataInput,
	currentMetadataFor,
} from "@/lib/airside-metadata.js";
import { effectiveClaimKind } from "@/lib/airside-profile.js";
import {
	incidentErrorTypesSchema,
	incidentsResponseSchema,
	incidentsWindowSchema,
	incidentErrorsClause,
	byokClauseFor,
	notRetriedClause,
	queryIncidentErrorTypes,
	buildErrorTimeline,
	errorTimelineSchema,
	queryIncidentMappings,
	resolveMappingErrorWindow,
} from "@/lib/mapping-error-shapes.js";
import {
	clearClaimVerificationKey,
	saveClaimVerificationKey,
} from "@/lib/model-verification.js";
import {
	bucketLabel,
	hourBucketStarts,
	utcDayBucketStarts,
} from "@/lib/series-buckets.js";
import { adminMiddleware } from "@/middleware/admin.js";

import {
	collectProviderEnvCredentials,
	readProviderEnvInventory,
} from "@llmgateway/actions";
import {
	AIRSIDE_BASELINE_MARGIN,
	AIRSIDE_DISCOUNT_MAX,
	AIRSIDE_MARGIN_MAX,
	AIRSIDE_MARGIN_MIN,
	and,
	cdb,
	computeAirsideAdjustment,
	count,
	db,
	eq,
	excludeRegionalMappingRows,
	gte,
	inArray,
	isNotNull,
	isNull,
	ne,
	sql,
	tables,
} from "@llmgateway/db";
import {
	models as catalogueModels,
	providers as catalogueProviders,
	PROVIDER_API_FORMATS,
} from "@llmgateway/models";
import {
	PROVIDER_BASE_URL_ENDPOINT_PATH_MESSAGE,
	providerBaseUrlHasEndpointPath,
} from "@llmgateway/shared";
import { AIRSIDE_BILLING_MODES } from "@llmgateway/shared/airside-billing";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";

/**
 * Admin review queue for Airside price filings. Approving an `initial` filing
 * activates the drafted model; rejecting it marks the model rejected. Update
 * filings only change the model's effective pricing (the latest approved
 * filing wins).
 */

export const adminAirside = new OpenAPIHono<ServerTypes>();

adminAirside.use("/*", adminMiddleware);

const adminFilingSchema = z.object({
	id: z.string(),
	kind: z.enum(["initial", "update", "metadata"]),
	status: z.enum(["pending", "approved", "rejected"]),
	inputPrice: z.string(),
	outputPrice: z.string(),
	cachedInputPrice: z.string().nullable(),
	requestPrice: z.string().nullable(),
	// Per-region overrides carried by the filing; approving replaces the
	// listing's regional pricing with exactly this set.
	regionPrices: z
		.array(
			z.object({
				region: z.string(),
				inputPrice: z.string(),
				outputPrice: z.string(),
				cachedInputPrice: z.string().nullable(),
				requestPrice: z.string().nullable(),
			}),
		)
		.nullable(),
	// "metadata" filings: the proposed changes and the listing's current
	// values for the same keys, for diffing.
	metadata: airsideModelMetadataSchema.nullable(),
	currentMetadata: airsideModelMetadataSchema.nullable(),
	note: z.string().nullable(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
	model: z.object({
		id: z.string(),
		providerId: z.string(),
		modelName: z.string(),
		externalId: z.string(),
		apiFormat: z.enum(PROVIDER_API_FORMATS),
		displayName: z.string().nullable(),
		status: z.enum(["draft", "active", "rejected", "delisted"]),
		// The name matches an existing catalogue model (id or alias): approving
		// attaches the carrier to that model's public entry.
		sharesCatalogueModelName: z.boolean(),
		// No catalogue model claims the name: once approved, the bare id (no
		// provider prefix) resolves to this carrier's listing.
		resolvesBareName: z.boolean(),
	}),
	company: z.object({
		id: z.string(),
		name: z.string(),
		website: z.string().nullable(),
	}),
	// The model's currently effective pricing, for diffing update filings.
	currentPricing: z
		.object({
			inputPrice: z.string(),
			outputPrice: z.string(),
			// Live regional fares, so a filing that changes or drops a region
			// shows the reviewer what it replaces.
			regionPrices: z
				.array(
					z.object({
						region: z.string(),
						inputPrice: z.string(),
						outputPrice: z.string(),
					}),
				)
				.nullable(),
		})
		.nullable(),
});

type FilingWithRelations = typeof tables.providerPriceFiling.$inferSelect & {
	draftModel: typeof tables.providerDraftModel.$inferSelect & {
		priceFilings?: (typeof tables.providerPriceFiling.$inferSelect)[];
	};
	providerCompany: typeof tables.providerCompany.$inferSelect;
};

// A carrier's requested routing-knob change. Approving writes the values into
// provider_routing_settings; nothing reaches the routing election before that.
const adminRoutingFilingSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	modelId: z.string().nullable(),
	status: z.enum(["pending", "approved", "rejected"]),
	initiatedBy: z.enum(["carrier", "admin"]),
	clearsOverride: z.boolean(),
	discountPercent: z.number(),
	marginPercent: z.number(),
	routingAdjustment: z.number(),
	// The live values, for judging the delta under review.
	currentDiscountPercent: z.number(),
	currentMarginPercent: z.number(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
	company: z.object({
		id: z.string(),
		name: z.string(),
		website: z.string().nullable(),
	}),
});

type RoutingFilingWithCompany =
	typeof tables.providerRoutingFiling.$inferSelect & {
		providerCompany: typeof tables.providerCompany.$inferSelect;
	};

function serializeAdminRoutingFiling(
	row: RoutingFilingWithCompany,
	current: typeof tables.providerRoutingSettings.$inferSelect | undefined,
) {
	const discountPercent = Number(row.discountPercent);
	const marginPercent = Number(row.marginPercent);
	return {
		id: row.id,
		providerId: row.providerId,
		modelId: row.modelId,
		status: row.status,
		initiatedBy: row.initiatedBy,
		clearsOverride: row.clearsOverride,
		discountPercent,
		marginPercent,
		routingAdjustment: computeAirsideAdjustment(discountPercent, marginPercent),
		currentDiscountPercent: current ? Number(current.discountPercent) : 0,
		currentMarginPercent: current
			? Number(current.marginPercent)
			: AIRSIDE_BASELINE_MARGIN,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		company: {
			id: row.providerCompany.id,
			name: row.providerCompany.name,
			website: row.providerCompany.website,
		},
	};
}

/** Whether any static catalogue model claims this name as its id or alias. */
function staticModelNameExists(modelName: string): boolean {
	return catalogueModels.some(
		(model) =>
			model.id === modelName ||
			("aliases" in model &&
				(model.aliases as readonly string[] | undefined)?.includes(modelName)),
	);
}

function serializeAdminFiling(row: FilingWithRelations) {
	const approved = [...(row.draftModel.priceFilings ?? [])]
		.filter((f) => f.status === "approved")
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
	const sharesCatalogueModelName = staticModelNameExists(
		row.draftModel.modelName,
	);
	return {
		id: row.id,
		kind: row.kind,
		status: row.status,
		inputPrice: row.inputPrice,
		outputPrice: row.outputPrice,
		cachedInputPrice: row.cachedInputPrice,
		requestPrice: row.requestPrice,
		regionPrices: row.regionPrices
			? row.regionPrices.map((entry) => ({
					region: entry.region,
					inputPrice: entry.inputPrice,
					outputPrice: entry.outputPrice,
					cachedInputPrice: entry.cachedInputPrice ?? null,
					requestPrice: entry.requestPrice ?? null,
				}))
			: null,
		metadata: (row.metadata ?? null) as AirsideModelMetadataInput | null,
		currentMetadata: row.metadata
			? (currentMetadataFor(
					row.draftModel,
					row.metadata,
				) as AirsideModelMetadataInput)
			: null,
		note: row.note,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		model: {
			id: row.draftModel.id,
			providerId: row.draftModel.providerId,
			modelName: row.draftModel.modelName,
			externalId: row.draftModel.externalId,
			apiFormat: row.draftModel.apiFormat,
			displayName: row.draftModel.displayName,
			status: row.draftModel.status,
			sharesCatalogueModelName,
			resolvesBareName: !sharesCatalogueModelName,
		},
		company: {
			id: row.providerCompany.id,
			name: row.providerCompany.name,
			website: row.providerCompany.website,
		},
		currentPricing: approved
			? {
					inputPrice: approved.inputPrice,
					outputPrice: approved.outputPrice,
					regionPrices: approved.regionPrices
						? approved.regionPrices.map((entry) => ({
								region: entry.region,
								inputPrice: entry.inputPrice,
								outputPrice: entry.outputPrice,
							}))
						: null,
				}
			: null,
	};
}

const listFilings = createRoute({
	method: "get",
	path: "/airside/filings",
	request: {
		query: z.object({
			status: z.enum(["pending", "approved", "rejected"]).optional(),
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			routingOffset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						filings: z.array(adminFilingSchema),
						total: z.number(),
						pendingCount: z.number(),
						routingFilings: z.array(adminRoutingFilingSchema),
						routingTotal: z.number(),
						routingPendingCount: z.number(),
					}),
				},
			},
			description:
				"Airside price and fare-change filings, newest first. `offset` pages price filings, `routingOffset` pages fare-change filings.",
		},
	},
});

adminAirside.openapi(listFilings, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	type FilingStatus = NonNullable<typeof query.status>;
	const countPrice = async (status: FilingStatus | undefined) => {
		const table = tables.providerPriceFiling;
		const [row] = await db
			.select({ count: count() })
			.from(table)
			.where(status ? eq(table.status, status) : undefined);
		return row?.count ?? 0;
	};
	const countRouting = async (status: FilingStatus | undefined) => {
		const table = tables.providerRoutingFiling;
		const [row] = await db
			.select({ count: count() })
			.from(table)
			.where(status ? eq(table.status, status) : undefined);
		return row?.count ?? 0;
	};
	const rows = await db.query.providerPriceFiling.findMany({
		where: query.status ? { status: { eq: query.status } } : undefined,
		with: {
			draftModel: { with: { priceFilings: true } },
			providerCompany: true,
		},
		orderBy: { createdAt: "desc", id: "desc" },
		limit,
		offset: query.offset ?? 0,
	});
	const routingRows = await db.query.providerRoutingFiling.findMany({
		where: query.status ? { status: { eq: query.status } } : undefined,
		with: { providerCompany: true },
		orderBy: { createdAt: "desc", id: "desc" },
		limit,
		offset: query.routingOffset ?? 0,
	});
	const [total, pendingCount, routingTotal, routingPendingCount] =
		await Promise.all([
			countPrice(query.status),
			countPrice("pending"),
			countRouting(query.status),
			countRouting("pending"),
		]);
	const currentSettings = routingRows.length
		? await db.query.providerRoutingSettings.findMany({
				where: {
					providerId: {
						in: [...new Set(routingRows.map((row) => row.providerId))],
					},
				},
			})
		: [];
	const routingScopeKey = (providerId: string, modelId: string | null) =>
		JSON.stringify([providerId, modelId]);
	const currentByScope = new Map(
		currentSettings.map((row) => [
			routingScopeKey(row.providerId, row.modelId),
			row,
		]),
	);
	return c.json({
		filings: rows.map((row) =>
			serializeAdminFiling(row as FilingWithRelations),
		),
		total,
		pendingCount,
		routingFilings: routingRows.map((row) =>
			serializeAdminRoutingFiling(
				row as RoutingFilingWithCompany,
				currentByScope.get(routingScopeKey(row.providerId, row.modelId)) ??
					currentByScope.get(routingScopeKey(row.providerId, null)),
			),
		),
		routingTotal,
		routingPendingCount,
	});
});

async function getPendingFiling(id: string) {
	const filing = await db.query.providerPriceFiling.findFirst({
		where: { id: { eq: id } },
		with: {
			draftModel: { with: { priceFilings: true } },
			providerCompany: true,
		},
	});
	if (!filing) {
		throw new HTTPException(404, { message: "Filing not found" });
	}
	if (filing.status !== "pending") {
		throw new HTTPException(409, {
			message: "This filing has already been reviewed.",
		});
	}
	return filing as FilingWithRelations;
}

const approveFiling = createRoute({
	method: "post",
	path: "/airside/filings/{id}/approve",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ filing: adminFilingSchema }),
				},
			},
			description:
				"The approved filing. Initial filings also activate the model.",
		},
	},
});

adminAirside.openapi(approveFiling, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const filing = await getPendingFiling(id);
	// cdb: approval flips a model live — the gateway's cached lookup must see it.
	await cdb.transaction(async (tx) => {
		// Lock and re-read the model so a concurrent pause/resume serializes
		// with this approval and its pausedAt decides the mapping status.
		const [model] = await tx
			.select()
			.from(tables.providerDraftModel)
			.where(eq(tables.providerDraftModel.id, filing.draftModelId))
			.for("update")
			.$withCache(false);
		if (!model) {
			throw new HTTPException(404, { message: "Model not found" });
		}
		// Guard on status inside the UPDATE so two concurrent reviews cannot
		// both apply — the loser sees zero rows and conflicts.
		const updated = await tx
			.update(tables.providerPriceFiling)
			.set({
				status: "approved",
				reviewedBy: user?.id ?? null,
				reviewedAt: new Date(),
			})
			.where(
				and(
					eq(tables.providerPriceFiling.id, id),
					eq(tables.providerPriceFiling.status, "pending"),
				),
			)
			.returning({ id: tables.providerPriceFiling.id });
		if (updated.length === 0) {
			throw new HTTPException(409, {
				message: "This filing has already been reviewed.",
			});
		}
		if (filing.kind === "initial") {
			const [activated] = await tx
				.update(tables.providerDraftModel)
				.set({ status: "active" })
				.where(eq(tables.providerDraftModel.id, filing.draftModelId))
				.returning();
			await materializeAirsideModel(activated, filing, tx);
			// A registered carrier's first provider key was filed with its first
			// model and smoke-tested against it; approving the model approves it.
			const [claim] = await tx
				.select()
				.from(tables.providerClaim)
				.where(
					and(
						eq(tables.providerClaim.providerId, model.providerId),
						eq(tables.providerClaim.providerCompanyId, model.providerCompanyId),
						eq(tables.providerClaim.status, "active"),
					),
				)
				.limit(1)
				.$withCache(false);
			if (claim?.pendingProviderKeyId && !claim.providerKeyId) {
				await promotePendingProviderKey(tx, claim, claim.pendingProviderKeyId);
			}
		} else if (filing.kind === "metadata") {
			const [row] = await tx
				.update(tables.providerDraftModel)
				.set(filing.metadata ?? {})
				.where(eq(tables.providerDraftModel.id, filing.draftModelId))
				.returning();
			await syncAirsideModelMetadata(row, tx);
		} else {
			await updateAirsideMappingPrices(model, filing, tx);
		}
	});
	const updated = await db.query.providerPriceFiling.findFirst({
		where: { id: { eq: id } },
		with: {
			draftModel: { with: { priceFilings: true } },
			providerCompany: true,
		},
	});
	return c.json({
		filing: serializeAdminFiling(updated as FilingWithRelations),
	});
});

const rejectFiling = createRoute({
	method: "post",
	path: "/airside/filings/{id}/reject",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reviewNote: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ filing: adminFilingSchema }),
				},
			},
			description:
				"The rejected filing. Initial filings also mark the model rejected.",
		},
	},
});

adminAirside.openapi(rejectFiling, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const { reviewNote } = c.req.valid("json");
	const filing = await getPendingFiling(id);
	await cdb.transaction(async (tx) => {
		const updated = await tx
			.update(tables.providerPriceFiling)
			.set({
				status: "rejected",
				reviewedBy: user?.id ?? null,
				reviewNote: reviewNote ?? null,
				reviewedAt: new Date(),
			})
			.where(
				and(
					eq(tables.providerPriceFiling.id, id),
					eq(tables.providerPriceFiling.status, "pending"),
				),
			)
			.returning({ id: tables.providerPriceFiling.id });
		if (updated.length === 0) {
			throw new HTTPException(409, {
				message: "This filing has already been reviewed.",
			});
		}
		if (filing.kind === "initial") {
			await tx
				.update(tables.providerDraftModel)
				.set({ status: "rejected" })
				.where(eq(tables.providerDraftModel.id, filing.draftModelId));
		}
	});
	const updated = await db.query.providerPriceFiling.findFirst({
		where: { id: { eq: id } },
		with: {
			draftModel: { with: { priceFilings: true } },
			providerCompany: true,
		},
	});
	return c.json({
		filing: serializeAdminFiling(updated as FilingWithRelations),
	});
});

// ---------------------------------------------------------------------------
// Carrier claims — new carriers only go live once approved here.
// ---------------------------------------------------------------------------

const carrierKeySchema = z.object({
	masked: z.string(),
	submittedAt: z.string(),
});

const adminClaimSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	kind: z.enum(["catalogue", "custom"]),
	customName: z.string().nullable(),
	customBaseUrl: z.string().nullable(),
	matchedDomain: z.string(),
	status: z.enum(["pending", "active", "rejected", "revoked"]),
	claimedByEmail: z.string().nullable(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
	logoUrl: z.string().nullable(),
	iconUrl: z.string().nullable(),
	// Branding edits on an active claim awaiting approval; null inside clears.
	pendingBranding: z
		.object({
			name: z.string().optional(),
			logoUrl: z.string().nullable().optional(),
			iconUrl: z.string().nullable().optional(),
		})
		.nullable(),
	billingMode: z.enum(AIRSIDE_BILLING_MODES),
	// Custom carriers only: the provider key serving traffic, and a
	// replacement awaiting approval here.
	providerKey: carrierKeySchema.nullable(),
	pendingProviderKey: carrierKeySchema.nullable(),
	company: z.object({
		id: z.string(),
		name: z.string(),
		website: z.string().nullable(),
		// Domains the company has proven and how. A reviewer weighs a claim
		// very differently when the company demonstrably controls the domain.
		verifiedDomains: z.array(
			z.object({ domain: z.string(), method: z.enum(["dns", "email"]) }),
		),
	}),
});

type ClaimWithRelations = typeof tables.providerClaim.$inferSelect & {
	providerCompany: typeof tables.providerCompany.$inferSelect;
};

async function serializeAdminClaim(row: ClaimWithRelations) {
	const claimer = row.claimedBy
		? await db.query.user.findFirst({
				where: { id: { eq: row.claimedBy } },
				columns: { email: true },
			})
		: null;
	const domains = await db.query.providerCompanyDomain.findMany({
		where: { providerCompanyId: { eq: row.providerCompanyId } },
		orderBy: { createdAt: "asc" },
	});
	const keyIds = [row.providerKeyId, row.pendingProviderKeyId].filter(
		(keyId): keyId is string => keyId !== null,
	);
	const keys =
		keyIds.length > 0
			? await db.query.providerKey.findMany({
					where: { id: { in: keyIds }, status: { ne: "deleted" } },
					columns: { id: true, tokenMasked: true, createdAt: true },
				})
			: [];
	const keySummary = (keyId: string | null) => {
		const key = keys.find((k) => k.id === keyId);
		return key
			? {
					masked: key.tokenMasked ?? "",
					submittedAt: key.createdAt.toISOString(),
				}
			: null;
	};
	return {
		id: row.id,
		providerId: row.providerId,
		providerName:
			row.customName ??
			catalogueProviders.find((provider) => provider.id === row.providerId)
				?.name ??
			row.providerId,
		kind: effectiveClaimKind(row),
		customName: row.customName,
		customBaseUrl: row.customBaseUrl,
		matchedDomain: row.matchedDomain,
		status: row.status,
		claimedByEmail: claimer?.email ?? null,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		logoUrl: row.logoUrl,
		iconUrl: row.iconUrl,
		pendingBranding: row.pendingBranding ?? null,
		billingMode: row.billingMode,
		providerKey: keySummary(row.providerKeyId),
		pendingProviderKey: keySummary(row.pendingProviderKeyId),
		company: {
			id: row.providerCompany.id,
			name: row.providerCompany.name,
			website: row.providerCompany.website,
			verifiedDomains: domains.flatMap((d) =>
				d.verifiedAt
					? [{ domain: d.domain, method: d.verificationMethod }]
					: [],
			),
		},
	};
}

const listClaims = createRoute({
	method: "get",
	path: "/airside/claims",
	request: {
		query: z.object({
			status: z.enum(["pending", "active", "rejected", "revoked"]).optional(),
			// Only claims with a branding change awaiting review.
			pendingBranding: z
				.enum(["true", "false"])
				.transform((value) => value === "true")
				.optional(),
			// Only claims with a provider key replacement awaiting review.
			pendingProviderKey: z
				.enum(["true", "false"])
				.transform((value) => value === "true")
				.optional(),
			limit: z.coerce.number().min(1).max(100).default(100).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						claims: z.array(adminClaimSchema),
						total: z.number(),
						pendingCount: z.number(),
					}),
				},
			},
			description: "Carrier claims, newest first.",
		},
	},
});

adminAirside.openapi(listClaims, async (c) => {
	const query = c.req.valid("query");
	const rows = await db.query.providerClaim.findMany({
		where: {
			...(query.status ? { status: { eq: query.status } } : {}),
			...(query.pendingBranding
				? { pendingBranding: { isNotNull: true } }
				: {}),
			...(query.pendingProviderKey
				? { pendingProviderKeyId: { isNotNull: true } }
				: {}),
		},
		with: { providerCompany: true },
		orderBy: { createdAt: "desc", id: "desc" },
		limit: query.limit ?? 100,
		offset: query.offset ?? 0,
	});
	const claimTable = tables.providerClaim;
	const countClaims = async (where: Parameters<typeof and>) => {
		const [row] = await db
			.select({ count: count() })
			.from(claimTable)
			.where(and(...where));
		return row?.count ?? 0;
	};
	const [total, pendingCount] = await Promise.all([
		countClaims([
			query.status ? eq(claimTable.status, query.status) : undefined,
			query.pendingBranding ? isNotNull(claimTable.pendingBranding) : undefined,
			query.pendingProviderKey
				? isNotNull(claimTable.pendingProviderKeyId)
				: undefined,
		]),
		countClaims([eq(claimTable.status, "pending")]),
	]);
	const claims = [];
	for (const row of rows) {
		claims.push(await serializeAdminClaim(row as ClaimWithRelations));
	}
	return c.json({ claims, total, pendingCount });
});

async function getPendingClaim(id: string) {
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	if (claim.status !== "pending") {
		throw new HTTPException(409, {
			message: "This claim has already been reviewed.",
		});
	}
	return claim as ClaimWithRelations;
}

async function getClaimWithPendingBranding(id: string) {
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	if (!claim.pendingBranding) {
		throw new HTTPException(409, {
			message: "This claim has no branding change awaiting review.",
		});
	}
	return claim as ClaimWithRelations;
}

const approveBranding = createRoute({
	method: "post",
	path: "/airside/claims/{id}/branding/approve",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ claim: adminClaimSchema }) },
			},
			description: "The claim with the pending branding applied.",
		},
	},
});

adminAirside.openapi(approveBranding, async (c) => {
	const { id } = c.req.valid("param");
	const claim = await getClaimWithPendingBranding(id);
	const pending = claim.pendingBranding!;
	// cdb: /internal/providers reads branding off cached claim rows.
	const [updated] = await cdb
		.update(tables.providerClaim)
		.set({
			...(pending.name !== undefined ? { customName: pending.name } : {}),
			...(pending.logoUrl !== undefined ? { logoUrl: pending.logoUrl } : {}),
			...(pending.iconUrl !== undefined ? { iconUrl: pending.iconUrl } : {}),
			pendingBranding: null,
		})
		.where(eq(tables.providerClaim.id, id))
		.returning();
	return c.json({
		claim: await serializeAdminClaim({
			...updated,
			providerCompany: claim.providerCompany,
		}),
	});
});

const rejectBranding = createRoute({
	method: "post",
	path: "/airside/claims/{id}/branding/reject",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ claim: adminClaimSchema }) },
			},
			description: "The claim with the pending branding discarded.",
		},
	},
});

adminAirside.openapi(rejectBranding, async (c) => {
	const { id } = c.req.valid("param");
	const claim = await getClaimWithPendingBranding(id);
	const [updated] = await cdb
		.update(tables.providerClaim)
		.set({ pendingBranding: null })
		.where(eq(tables.providerClaim.id, id))
		.returning();
	return c.json({
		claim: await serializeAdminClaim({
			...updated,
			providerCompany: claim.providerCompany,
		}),
	});
});

type CacheTransaction = Parameters<Parameters<typeof cdb.transaction>[0]>[0];

/** Puts a carrier's approved provider key into service and retires the old one. */
async function promotePendingProviderKey(
	tx: CacheTransaction,
	claim: typeof tables.providerClaim.$inferSelect,
	pendingId: string,
) {
	const updated = await tx
		.update(tables.providerClaim)
		.set({ providerKeyId: pendingId, pendingProviderKeyId: null })
		.where(
			and(
				eq(tables.providerClaim.id, claim.id),
				eq(tables.providerClaim.pendingProviderKeyId, pendingId),
			),
		)
		.returning({ id: tables.providerClaim.id });
	if (updated.length === 0) {
		throw new HTTPException(409, {
			message: "The provider key changed in the meantime — reload.",
		});
	}
	await tx
		.update(tables.providerKey)
		.set({ status: "active" })
		.where(eq(tables.providerKey.id, pendingId));
	if (claim.providerKeyId) {
		await tx
			.update(tables.providerKey)
			.set({ status: "deleted" })
			.where(eq(tables.providerKey.id, claim.providerKeyId));
	}
}

const approveClaim = createRoute({
	method: "post",
	path: "/airside/claims/{id}/approve",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ claim: adminClaimSchema }),
				},
			},
			description:
				"The approved claim. The carrier becomes operational immediately.",
		},
	},
});

adminAirside.openapi(approveClaim, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const claim = await getPendingClaim(id);
	// cdb: the gateway resolves custom carriers from active claim rows, so the
	// status flip must invalidate its cache.
	await cdb.transaction(async (tx) => {
		const updated = await tx
			.update(tables.providerClaim)
			.set({
				status: "active",
				reviewedBy: user?.id ?? null,
				reviewedAt: new Date(),
			})
			.where(
				and(
					eq(tables.providerClaim.id, id),
					eq(tables.providerClaim.status, "pending"),
				),
			)
			.returning({ id: tables.providerClaim.id });
		if (updated.length === 0) {
			throw new HTTPException(409, {
				message: "This claim has already been reviewed.",
			});
		}
		if (effectiveClaimKind(claim) === "custom") {
			// A custom carrier only exists in the DB catalogue: create its
			// provider row so /providers and /internal/providers list it.
			await tx
				.insert(tables.provider)
				.values({
					id: claim.providerId,
					name: claim.customName ?? claim.providerId,
					description: claim.customDescription ?? "",
				})
				.onConflictDoNothing();
		}
		const [settings] = await tx
			.select()
			.from(tables.providerRoutingSettings)
			.where(
				and(
					eq(tables.providerRoutingSettings.providerId, claim.providerId),
					sql`${tables.providerRoutingSettings.modelId} IS NULL`,
				),
			)
			.limit(1);
		if (!settings) {
			await tx.insert(tables.providerRoutingSettings).values({
				providerCompanyId: claim.providerCompanyId,
				providerId: claim.providerId,
			});
		} else if (settings.providerCompanyId !== claim.providerCompanyId) {
			// The provider changed hands: reset the routing knobs to defaults
			// under the new owner instead of inheriting the old company's.
			await tx
				.update(tables.providerRoutingSettings)
				.set({
					providerCompanyId: claim.providerCompanyId,
					discountPercent: "0",
					marginPercent: String(0.2),
				})
				.where(eq(tables.providerRoutingSettings.id, settings.id));
		}
	});
	const updated = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	return c.json({
		claim: await serializeAdminClaim(updated as ClaimWithRelations),
	});
});

// A carrier's replacement provider key only serves traffic once approved
// here. Airside smoke-tested it before filing it for review.
async function getClaimWithPendingProviderKey(id: string) {
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	if (claim.status !== "active" || !claim.pendingProviderKeyId) {
		throw new HTTPException(409, {
			message: "This claim has no provider key awaiting review.",
		});
	}
	return claim as ClaimWithRelations & { pendingProviderKeyId: string };
}

const approveProviderKey = createRoute({
	method: "post",
	path: "/airside/claims/{id}/provider-key/approve",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ claim: adminClaimSchema }) },
			},
			description:
				"The claim with the new provider key serving and the old one retired.",
		},
	},
});

adminAirside.openapi(approveProviderKey, async (c) => {
	const { id } = c.req.valid("param");
	const claim = await getClaimWithPendingProviderKey(id);
	const pendingId = claim.pendingProviderKeyId;
	// cdb: managed provider_key rows feed the gateway's credential cache.
	await cdb.transaction(async (tx) => {
		await promotePendingProviderKey(tx, claim, pendingId);
	});
	const updated = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	return c.json({
		claim: await serializeAdminClaim(updated as ClaimWithRelations),
	});
});

const rejectProviderKey = createRoute({
	method: "post",
	path: "/airside/claims/{id}/provider-key/reject",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ claim: adminClaimSchema }) },
			},
			description: "The claim with the replacement discarded.",
		},
	},
});

adminAirside.openapi(rejectProviderKey, async (c) => {
	const { id } = c.req.valid("param");
	const claim = await getClaimWithPendingProviderKey(id);
	await discardPendingProviderKey(claim, claim.pendingProviderKeyId);
	const updated = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	return c.json({
		claim: await serializeAdminClaim(updated as ClaimWithRelations),
	});
});

const rejectClaim = createRoute({
	method: "post",
	path: "/airside/claims/{id}/reject",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reviewNote: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ claim: adminClaimSchema }),
				},
			},
			description: "The rejected claim. The provider becomes claimable again.",
		},
	},
});

adminAirside.openapi(rejectClaim, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const { reviewNote } = c.req.valid("json");
	await getPendingClaim(id);
	const guarded = await db
		.update(tables.providerClaim)
		.set({
			status: "rejected",
			reviewedBy: user?.id ?? null,
			reviewNote: reviewNote ?? null,
			reviewedAt: new Date(),
		})
		.where(
			and(
				eq(tables.providerClaim.id, id),
				eq(tables.providerClaim.status, "pending"),
			),
		)
		.returning({ id: tables.providerClaim.id });
	if (guarded.length === 0) {
		throw new HTTPException(409, {
			message: "This claim has already been reviewed.",
		});
	}
	const updated = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	return c.json({
		claim: await serializeAdminClaim(updated as ClaimWithRelations),
	});
});

const revokeClaim = createRoute({
	method: "post",
	path: "/airside/claims/{id}/revoke",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reviewNote: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ claim: adminClaimSchema }),
				},
			},
			description:
				"The revoked claim. The carrier loses portal control of the provider and its routing boost is removed.",
		},
	},
});

adminAirside.openapi(revokeClaim, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const { reviewNote } = c.req.valid("json");
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	if (claim.status !== "active") {
		throw new HTTPException(409, {
			message: "Only active claims can be revoked.",
		});
	}
	// cdb so the gateway's cached multiplier reads are invalidated.
	await cdb.transaction(async (tx) => {
		const updated = await tx
			.update(tables.providerClaim)
			.set({
				status: "revoked",
				reviewedBy: user?.id ?? null,
				reviewNote: reviewNote ?? null,
				reviewedAt: new Date(),
				revokedAt: new Date(),
				// A branding change filed before revocation must not linger in
				// the review queue.
				pendingBranding: null,
			})
			.where(
				and(
					eq(tables.providerClaim.id, id),
					eq(tables.providerClaim.status, "active"),
				),
			)
			.returning({ id: tables.providerClaim.id });
		if (updated.length === 0) {
			throw new HTTPException(409, {
				message: "Only active claims can be revoked.",
			});
		}
		// Tear down what the carrier controlled: the settings row that prices
		// the routing election (a future owner starts from defaults). Admin
		// provider prioritization (routing_score_multiplier) is a separate
		// internal knob and is left alone.
		await tx
			.delete(tables.providerRoutingSettings)
			.where(eq(tables.providerRoutingSettings.providerId, claim.providerId));
		// A custom carrier's credentials are the carrier's own keys.
		if (effectiveClaimKind(claim) === "custom") {
			await tx
				.update(tables.providerKey)
				.set({ status: "deleted" })
				.where(
					and(
						eq(tables.providerKey.provider, claim.providerId),
						eq(tables.providerKey.managed, true),
					),
				);
			await tx
				.update(tables.providerClaim)
				.set({ providerKeyId: null, pendingProviderKeyId: null })
				.where(eq(tables.providerClaim.id, id));
		}
		// A pending fare change would otherwise survive as a zombie and block
		// the provider's next owner (one pending filing per provider).
		await tx
			.update(tables.providerRoutingFiling)
			.set({
				status: "rejected",
				reviewedBy: user?.id ?? null,
				reviewNote: "Carrier claim revoked",
				reviewedAt: new Date(),
			})
			.where(
				and(
					eq(tables.providerRoutingFiling.providerId, claim.providerId),
					eq(tables.providerRoutingFiling.status, "pending"),
				),
			);
		// Revocation ends portal control entirely: the company's listings for
		// this provider stop routing and stop accepting edits or filings.
		const companyModels = await tx
			.select({
				id: tables.providerDraftModel.id,
				modelName: tables.providerDraftModel.modelName,
			})
			.from(tables.providerDraftModel)
			.where(
				and(
					eq(
						tables.providerDraftModel.providerCompanyId,
						claim.providerCompanyId,
					),
					eq(tables.providerDraftModel.providerId, claim.providerId),
					ne(tables.providerDraftModel.status, "delisted"),
				),
			);
		if (companyModels.length > 0) {
			const modelIds = companyModels.map((m) => m.id);
			await tx
				.update(tables.providerPriceFiling)
				.set({
					status: "rejected",
					reviewedBy: user?.id ?? null,
					reviewNote: "Carrier claim revoked",
					reviewedAt: new Date(),
				})
				.where(
					and(
						inArray(tables.providerPriceFiling.draftModelId, modelIds),
						eq(tables.providerPriceFiling.status, "pending"),
					),
				);
			await tx
				.update(tables.providerDraftModel)
				.set({
					status: "delisted",
					delistedAt: new Date(),
					delistReason: "claim_revoked",
					pausedAt: null,
				})
				.where(inArray(tables.providerDraftModel.id, modelIds));
		}
		// Hand every pair the carrier owned back to the static catalogue,
		// including the ones it delisted itself.
		const ownedMappings = await tx
			.selectDistinct({ modelId: tables.modelProviderMapping.modelId })
			.from(tables.modelProviderMapping)
			.where(
				and(
					eq(tables.modelProviderMapping.providerId, claim.providerId),
					eq(tables.modelProviderMapping.source, "airside"),
				),
			)
			.$withCache(false);
		for (const mapping of ownedMappings) {
			await dematerializeAirsideModel(claim.providerId, mapping.modelId, tx, {
				restoreStatic: true,
			});
		}
		if (effectiveClaimKind(claim) === "custom") {
			// The provider row only existed for this registration; drop it once no
			// catalogue mapping references it any more.
			const remaining = await tx
				.select({ id: tables.modelProviderMapping.id })
				.from(tables.modelProviderMapping)
				.where(eq(tables.modelProviderMapping.providerId, claim.providerId))
				.limit(1);
			if (remaining.length === 0) {
				await tx
					.delete(tables.provider)
					.where(eq(tables.provider.id, claim.providerId));
			}
		}
	});
	const updated = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	return c.json({
		claim: await serializeAdminClaim(updated as ClaimWithRelations),
	});
});

const listIncidents = createRoute({
	method: "get",
	path: "/airside/incidents",
	request: {
		query: z.object({
			providerId: z.string(),
			/** Exact `used_model` (`provider/model[:region]`). */
			mapping: z.string().optional(),
			window: incidentsWindowSchema.default("24h").optional(),
			/** Include errors and requests served by customers' own keys. */
			includeByok: z.enum(["true", "false"]).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: incidentsResponseSchema.openapi({}),
				},
			},
			description:
				"Per-mapping upstream + gateway error counts of one provider — the carrier's Incidents view.",
		},
	},
});

adminAirside.openapi(listIncidents, async (c) => {
	const query = c.req.valid("query");
	const { hours: windowHours } = resolveMappingErrorWindow(query.window, "24h");
	const mapping = query.mapping ?? null;
	const providerIds = [query.providerId];
	return c.json({
		windowHours,
		providerIds,
		mapping,
		mappings: await queryIncidentMappings({
			providerIds,
			windowHours,
			mapping,
			includeByok: query.includeByok === "true",
		}),
	});
});

const listIncidentErrorTypes = createRoute({
	method: "get",
	path: "/airside/incidents/error-types",
	request: {
		query: z.object({
			providerId: z.string(),
			/** Exact `used_model` (`provider/model[:region]`). */
			mapping: z.string().optional(),
			window: incidentsWindowSchema.default("24h").optional(),
			/** Include errors and requests served by customers' own keys. */
			includeByok: z.enum(["true", "false"]).optional(),
			includeRetried: z.enum(["true", "false"]).default("true").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: incidentErrorTypesSchema
						.extend({ timeline: errorTimelineSchema })
						.openapi({}),
				},
			},
			description:
				"Top error shapes across one provider's mappings, each with its per-mapping, streaming, and per-bucket counts.",
		},
	},
});

adminAirside.openapi(listIncidentErrorTypes, async (c) => {
	const query = c.req.valid("query");
	const {
		hours: windowHours,
		interval: windowInterval,
		bucketSeconds,
	} = resolveMappingErrorWindow(query.window, "24h");
	return c.json({
		timeline: buildErrorTimeline(windowHours, bucketSeconds),
		...(await queryIncidentErrorTypes({
			bucketSeconds,
			mappings: await queryIncidentMappings({
				providerIds: [query.providerId],
				windowHours,
				mapping: query.mapping ?? null,
				includeByok: query.includeByok === "true",
			}),
			windowInterval,
			extraClauses: [
				incidentErrorsClause,
				byokClauseFor(query.includeByok),
				query.includeRetried === "false" ? notRetriedClause : sql``,
			],
		})),
	});
});

const listCompanies = createRoute({
	method: "get",
	path: "/airside/companies",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						companies: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								website: z.string().nullable(),
								createdAt: z.string(),
								members: z.array(
									z.object({
										email: z.string(),
										role: z.enum(["owner", "member"]),
									}),
								),
								claims: z.array(
									z.object({
										providerId: z.string(),
										matchedDomain: z.string(),
										status: z.enum([
											"pending",
											"active",
											"rejected",
											"revoked",
										]),
									}),
								),
								modelCount: z.number(),
							}),
						),
					}),
				},
			},
			description: "All Airside provider companies with members and claims.",
		},
	},
});

adminAirside.openapi(listCompanies, async (c) => {
	const companies = await db.query.providerCompany.findMany({
		with: {
			members: { with: { user: true } },
			claims: true,
			draftModels: { columns: { id: true } },
		},
		orderBy: { createdAt: "desc" },
	});
	return c.json({
		companies: companies.map((company) => ({
			id: company.id,
			name: company.name,
			website: company.website,
			createdAt: company.createdAt.toISOString(),
			members: company.members.flatMap((member) =>
				member.user ? [{ email: member.user.email, role: member.role }] : [],
			),
			claims: company.claims.map((claim) => ({
				providerId: claim.providerId,
				matchedDomain: claim.matchedDomain,
				status: claim.status,
			})),
			modelCount: company.draftModels.length,
		})),
	});
});

const carrierWindowSchema = z.enum(["24h", "7d", "30d"]);

const carrierSeriesPointSchema = z.object({
	date: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	clientErrorCount: z.number(),
	gatewayErrorCount: z.number(),
	upstreamErrorCount: z.number(),
});

/**
 * Bucket grid for the carriers table's traffic window: 24 hours ending with the
 * hour in progress, or whole UTC days ending today.
 */
function carrierWindowBuckets(window: z.infer<typeof carrierWindowSchema>) {
	if (window === "24h") {
		return { bucket: "hour" as const, starts: hourBucketStarts(24) };
	}
	return {
		bucket: "day" as const,
		starts: utcDayBucketStarts(window === "7d" ? 7 : 30),
	};
}

const listRoutingSettings = createRoute({
	method: "get",
	path: "/airside/routing-settings",
	request: {
		query: z.object({
			window: carrierWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						window: carrierWindowSchema,
						bucket: z.enum(["hour", "day"]),
						providers: z.array(
							z.object({
								providerId: z.string(),
								company: z.object({ id: z.string(), name: z.string() }),
								// Inactive = no active root mapping left to route to.
								status: z.enum(["active", "inactive"]),
								activeMappingCount: z.number(),
								airsideMappingCount: z.number(),
								// Who added the key serving the carrier, null without one.
								// Admin keys (incl. LLM_* env vars) bill our account
								// pay-as-you-go; carrier keys bill the carrier's own account.
								keySource: z.enum(["admin", "carrier"]).nullable(),
								// From the active claim; payg when none is left.
								billingMode: z.enum(AIRSIDE_BILLING_MODES),
								discountPercent: z.number(),
								marginPercent: z.number(),
								// Signed routing-price adjustment (negative = boosted).
								routingAdjustment: z.number(),
								// Gateway margin earned on this carrier's traffic, from
								// global_model_stats.provider_margin_amount.
								marginAmount30d: z.number(),
								marginAmountTotal: z.number(),
								// Traffic over `window`, from the hourly mapping rollup.
								routedCost: z.number(),
								requestCount: z.number(),
								clientErrorCount: z.number(),
								gatewayErrorCount: z.number(),
								upstreamErrorCount: z.number(),
								// Zero-filled, oldest first; the last bucket is in progress.
								series: z.array(carrierSeriesPointSchema),
								updatedAt: z.string(),
							}),
						),
					}),
				},
			},
			description:
				"Every Airside carrier's routing settings, traffic, and accrued gateway margin.",
		},
	},
});

/** Per-carrier traffic series over the window, one grouped query. */
async function getCarrierTrafficSeries(
	providerIds: string[],
	{ bucket, starts }: ReturnType<typeof carrierWindowBuckets>,
) {
	const series = new Map<string, z.infer<typeof carrierSeriesPointSchema>[]>();
	if (providerIds.length === 0) {
		return series;
	}

	const history = tables.modelProviderMappingHistoryHourly;
	const bucketExpr =
		bucket === "hour"
			? sql<Date>`${history.hourTimestamp}`
			: sql<Date>`date_trunc('day', ${history.hourTimestamp})`;
	const rows = await db
		.select({
			providerId: history.providerId,
			bucket: bucketLabel(bucketExpr).as("bucket"),
			cost: sql<number>`coalesce(sum(cast(${history.totalCost} as double precision)), 0)`.as(
				"cost",
			),
			requestCount: sql<number>`coalesce(sum(${history.logsCount}), 0)`.as(
				"request_count",
			),
			clientErrorCount:
				sql<number>`coalesce(sum(${history.clientErrorsCount}), 0)`.as(
					"client_error_count",
				),
			gatewayErrorCount:
				sql<number>`coalesce(sum(${history.gatewayErrorsCount}), 0)`.as(
					"gateway_error_count",
				),
			upstreamErrorCount:
				sql<number>`coalesce(sum(${history.upstreamErrorsCount}), 0)`.as(
					"upstream_error_count",
				),
		})
		.from(history)
		.where(
			and(
				inArray(history.providerId, providerIds),
				gte(history.hourTimestamp, starts[0]),
				excludeRegionalMappingRows(history),
			),
		)
		.groupBy(history.providerId, bucketExpr);

	const byProviderAndBucket = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		byProviderAndBucket.set(`${row.providerId}:${row.bucket}`, row);
	}
	for (const providerId of providerIds) {
		series.set(
			providerId,
			starts.map((start) => {
				const date = start.toISOString();
				const row = byProviderAndBucket.get(`${providerId}:${date}`);
				return {
					date,
					cost: Number(row?.cost ?? 0),
					requestCount: Number(row?.requestCount ?? 0),
					clientErrorCount: Number(row?.clientErrorCount ?? 0),
					gatewayErrorCount: Number(row?.gatewayErrorCount ?? 0),
					upstreamErrorCount: Number(row?.upstreamErrorCount ?? 0),
				};
			}),
		);
	}
	return series;
}

adminAirside.openapi(listRoutingSettings, async (c) => {
	const window = c.req.valid("query").window ?? "7d";
	const buckets = carrierWindowBuckets(window);

	const rows = await db
		.select({
			providerId: tables.providerRoutingSettings.providerId,
			discountPercent: tables.providerRoutingSettings.discountPercent,
			marginPercent: tables.providerRoutingSettings.marginPercent,
			updatedAt: tables.providerRoutingSettings.updatedAt,
			companyId: tables.providerCompany.id,
			companyName: tables.providerCompany.name,
			billingMode: tables.providerClaim.billingMode,
		})
		.from(tables.providerRoutingSettings)
		.innerJoin(
			tables.providerCompany,
			eq(
				tables.providerRoutingSettings.providerCompanyId,
				tables.providerCompany.id,
			),
		)
		.leftJoin(
			tables.providerClaim,
			and(
				eq(
					tables.providerClaim.providerId,
					tables.providerRoutingSettings.providerId,
				),
				eq(tables.providerClaim.status, "active"),
			),
		)
		.where(sql`${tables.providerRoutingSettings.modelId} IS NULL`)
		.orderBy(tables.providerCompany.name);

	const providerIds = rows.map((row) => row.providerId);
	// UTC string cutoff: dayTimestamp is `timestamp without time zone`, so
	// comparing against now() would go through the server timezone.
	const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
	const cutoff = new Date(Date.now() - thirtyDaysMs)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
	const mapping = tables.modelProviderMapping;
	const providerKey = tables.providerKey;
	const [totals, mappingCounts, traffic, primaryKeys, envInventory] =
		providerIds.length
			? await Promise.all([
					db
						.select({
							usedProvider: tables.globalModelStats.usedProvider,
							total:
								sql<number>`coalesce(sum(cast(${tables.globalModelStats.providerMarginAmount} as double precision)), 0)`.as(
									"total",
								),
							last30d:
								sql<number>`coalesce(sum(cast(${tables.globalModelStats.providerMarginAmount} as double precision)) filter (where ${tables.globalModelStats.dayTimestamp} >= ${cutoff}::timestamp), 0)`.as(
									"last30d",
								),
						})
						.from(tables.globalModelStats)
						.where(
							and(
								inArray(tables.globalModelStats.usedProvider, providerIds),
								eq(tables.globalModelStats.usedMode, "credits"),
							),
						)
						.groupBy(tables.globalModelStats.usedProvider),
					db
						.select({
							providerId: mapping.providerId,
							active: count(),
							airside:
								sql<number>`count(*) filter (where ${mapping.source} = 'airside')`.as(
									"airside",
								),
						})
						.from(mapping)
						.where(
							and(
								inArray(mapping.providerId, providerIds),
								eq(mapping.status, "active"),
								isNull(mapping.region),
							),
						)
						.groupBy(mapping.providerId),
					getCarrierTrafficSeries(providerIds, buckets),
					// The gateway's primary key: first active managed key in its
					// selection order (see listManagedProviderKeys).
					db
						.selectDistinctOn([providerKey.provider], {
							provider: providerKey.provider,
							carrierSubmitted: providerKey.carrierSubmitted,
						})
						.from(providerKey)
						.where(
							and(
								inArray(providerKey.provider, providerIds),
								eq(providerKey.managed, true),
								eq(providerKey.status, "active"),
							),
						)
						.orderBy(
							providerKey.provider,
							providerKey.sortOrder,
							providerKey.createdAt,
							providerKey.id,
						),
					readProviderEnvInventory(),
				])
			: [
					[],
					[],
					new Map<string, z.infer<typeof carrierSeriesPointSchema>[]>(),
					[],
					null,
				];
	const totalsByProvider = new Map(
		totals.map((row) => [row.usedProvider, row]),
	);
	const countsByProvider = new Map(
		mappingCounts.map((row) => [row.providerId, row]),
	);
	const primaryKeyByProvider = new Map(
		primaryKeys.map((row) => [row.provider, row]),
	);
	const keySourceFor = (providerId: string) => {
		const primary = primaryKeyByProvider.get(providerId);
		if (primary) {
			return primary.carrierSubmitted ? "carrier" : "admin";
		}
		// Managed keys supersede LLM_* env vars, which serve only without one.
		// Same fallback as the credentials catalog: local env when the gateway
		// has not published its inventory.
		const envKeys = envInventory
			? (envInventory.providers[providerId] ?? [])
			: collectProviderEnvCredentials(providerId);
		return envKeys.length > 0 ? "admin" : null;
	};

	return c.json({
		window,
		bucket: buckets.bucket,
		providers: rows.map((row) => {
			const discountPercent = Number(row.discountPercent);
			const marginPercent = Number(row.marginPercent);
			const accrued = totalsByProvider.get(row.providerId);
			const counts = countsByProvider.get(row.providerId);
			const activeMappingCount = Number(counts?.active ?? 0);
			const series = traffic.get(row.providerId) ?? [];
			const sum = (key: Exclude<keyof (typeof series)[number], "date">) =>
				series.reduce((total, point) => total + point[key], 0);
			return {
				providerId: row.providerId,
				company: { id: row.companyId, name: row.companyName },
				status:
					activeMappingCount > 0 ? ("active" as const) : ("inactive" as const),
				activeMappingCount,
				airsideMappingCount: Number(counts?.airside ?? 0),
				keySource: keySourceFor(row.providerId),
				billingMode: row.billingMode ?? "payg",
				discountPercent,
				marginPercent,
				routingAdjustment: computeAirsideAdjustment(
					discountPercent,
					marginPercent,
				),
				marginAmount30d: Number(accrued?.last30d ?? 0),
				marginAmountTotal: Number(accrued?.total ?? 0),
				routedCost: sum("cost"),
				requestCount: sum("requestCount"),
				clientErrorCount: sum("clientErrorCount"),
				gatewayErrorCount: sum("gatewayErrorCount"),
				upstreamErrorCount: sum("upstreamErrorCount"),
				series,
				updatedAt: row.updatedAt.toISOString(),
			};
		}),
	});
});

// ---------------------------------------------------------------------------
// Fare-change (routing) filings — approving one is what moves the knobs.
// ---------------------------------------------------------------------------

async function getPendingRoutingFiling(id: string) {
	const filing = await db.query.providerRoutingFiling.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	if (!filing) {
		throw new HTTPException(404, { message: "Filing not found" });
	}
	if (filing.status !== "pending") {
		throw new HTTPException(409, {
			message: "This filing has already been reviewed.",
		});
	}
	return filing as RoutingFilingWithCompany;
}

async function serializeRoutingFilingWithCurrent(id: string) {
	const filing = await db.query.providerRoutingFiling.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	const current = filing
		? ((await db.query.providerRoutingSettings.findFirst({
				where: {
					providerId: { eq: filing.providerId },
					modelId: filing.modelId ? { eq: filing.modelId } : { isNull: true },
				},
			})) ??
			(await db.query.providerRoutingSettings.findFirst({
				where: {
					providerId: { eq: filing.providerId },
					modelId: { isNull: true },
				},
			})))
		: undefined;
	return serializeAdminRoutingFiling(
		filing as RoutingFilingWithCompany,
		current,
	);
}

const approveRoutingFiling = createRoute({
	method: "post",
	path: "/airside/routing-filings/{id}/approve",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ filing: adminRoutingFilingSchema }),
				},
			},
			description:
				"The approved filing. Its values are now the carrier's live routing settings.",
		},
	},
});

adminAirside.openapi(approveRoutingFiling, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const filing = await getPendingRoutingFiling(id);
	// cdb: the gateway prices the routing election from provider_routing_settings.
	await cdb.transaction(async (tx) => {
		const updated = await tx
			.update(tables.providerRoutingFiling)
			.set({
				status: "approved",
				reviewedBy: user?.id ?? null,
				reviewedAt: new Date(),
			})
			.where(
				and(
					eq(tables.providerRoutingFiling.id, id),
					eq(tables.providerRoutingFiling.status, "pending"),
				),
			)
			.returning({ id: tables.providerRoutingFiling.id });
		if (updated.length === 0) {
			throw new HTTPException(409, {
				message: "This filing has already been reviewed.",
			});
		}
		const [current] = await tx
			.select()
			.from(tables.providerRoutingSettings)
			.where(
				and(
					eq(tables.providerRoutingSettings.providerId, filing.providerId),
					filing.modelId
						? eq(tables.providerRoutingSettings.modelId, filing.modelId)
						: sql`${tables.providerRoutingSettings.modelId} IS NULL`,
				),
			)
			.limit(1);
		if (current) {
			await tx
				.update(tables.providerRoutingSettings)
				.set({
					providerCompanyId: filing.providerCompanyId,
					discountPercent: filing.discountPercent,
					marginPercent: filing.marginPercent,
				})
				.where(eq(tables.providerRoutingSettings.id, current.id));
		} else {
			await tx.insert(tables.providerRoutingSettings).values({
				providerId: filing.providerId,
				modelId: filing.modelId,
				providerCompanyId: filing.providerCompanyId,
				discountPercent: filing.discountPercent,
				marginPercent: filing.marginPercent,
			});
		}
	});
	return c.json({ filing: await serializeRoutingFilingWithCurrent(id) });
});

const rejectRoutingFiling = createRoute({
	method: "post",
	path: "/airside/routing-filings/{id}/reject",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reviewNote: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ filing: adminRoutingFilingSchema }),
				},
			},
			description: "The rejected filing. Live routing settings are untouched.",
		},
	},
});

adminAirside.openapi(rejectRoutingFiling, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const { reviewNote } = c.req.valid("json");
	await getPendingRoutingFiling(id);
	const updated = await db
		.update(tables.providerRoutingFiling)
		.set({
			status: "rejected",
			reviewedBy: user?.id ?? null,
			reviewNote: reviewNote ?? null,
			reviewedAt: new Date(),
		})
		.where(
			and(
				eq(tables.providerRoutingFiling.id, id),
				eq(tables.providerRoutingFiling.status, "pending"),
			),
		)
		.returning({ id: tables.providerRoutingFiling.id });
	if (updated.length === 0) {
		throw new HTTPException(409, {
			message: "This filing has already been reviewed.",
		});
	}
	return c.json({ filing: await serializeRoutingFilingWithCurrent(id) });
});

// ---------------------------------------------------------------------------
// Direct carrier settings edits. Admin changes skip the filing and branding
// review queues the carrier portal goes through.
// ---------------------------------------------------------------------------

async function getActiveClaim(id: string) {
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	if (claim.status !== "active") {
		throw new HTTPException(409, {
			message: "Only an active claim's settings can be edited.",
		});
	}
	return claim as ClaimWithRelations;
}

const updateClaimSettings = createRoute({
	method: "patch",
	path: "/airside/claims/{id}/settings",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().trim().min(2).max(100).optional(),
						// Custom carriers only.
						baseUrl: z.string().url().max(500).optional(),
						description: z.string().max(2000).nullable().optional(),
						// null clears the image; omitted keeps the current one.
						logoUrl: imageDataUrl(LOGO_MAX_BYTES).nullish(),
						iconUrl: imageDataUrl(ICON_MAX_BYTES).nullish(),
						billingMode: z.enum(AIRSIDE_BILLING_MODES).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ claim: adminClaimSchema }) },
			},
			description: "The claim with the changes applied immediately.",
		},
	},
});

adminAirside.openapi(updateClaimSettings, async (c) => {
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const claim = await getActiveClaim(id);
	if (
		effectiveClaimKind(claim) !== "custom" &&
		body.description !== undefined
	) {
		throw new HTTPException(400, {
			message: "Only custom carriers have a description.",
		});
	}
	if (body.baseUrl !== undefined) {
		if (providerBaseUrlHasEndpointPath(body.baseUrl)) {
			throw new HTTPException(400, {
				message: PROVIDER_BASE_URL_ENDPOINT_PATH_MESSAGE,
			});
		}
		await assertSafeProviderUrl(body.baseUrl);
	}
	const changes = {
		...(body.name !== undefined ? { customName: body.name } : {}),
		...(body.baseUrl !== undefined ? { customBaseUrl: body.baseUrl } : {}),
		...(body.description !== undefined
			? { customDescription: body.description }
			: {}),
		...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
		...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}),
		...(body.billingMode !== undefined
			? { billingMode: body.billingMode }
			: {}),
	};
	if (Object.keys(changes).length === 0) {
		return c.json({ claim: await serializeAdminClaim(claim) });
	}
	// cdb: the gateway resolves custom carriers (base URL, branding) from
	// cached claim rows.
	const [updated] = await cdb
		.update(tables.providerClaim)
		.set(changes)
		.where(eq(tables.providerClaim.id, id))
		.returning();
	return c.json({
		claim: await serializeAdminClaim({
			...updated,
			providerCompany: claim.providerCompany,
		}),
	});
});

const adminVerificationKeySchema = z.object({
	verificationKeyMasked: z.string().nullable(),
	verificationKeySetAt: z.string().nullable(),
});

const setClaimVerificationKey = createRoute({
	method: "put",
	path: "/airside/claims/{id}/verification-key",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ apiKey: z.string().min(1).max(20_000) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: adminVerificationKeySchema } },
			description: "The saved verification key, masked.",
		},
	},
});

adminAirside.openapi(setClaimVerificationKey, async (c) => {
	const { id } = c.req.valid("param");
	const { apiKey } = c.req.valid("json");
	const claim = await getActiveClaim(id);
	return c.json(await saveClaimVerificationKey(claim, apiKey));
});

const deleteClaimVerificationKey = createRoute({
	method: "delete",
	path: "/airside/claims/{id}/verification-key",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: { "application/json": { schema: adminVerificationKeySchema } },
			description: "The cleared verification key.",
		},
	},
});

adminAirside.openapi(deleteClaimVerificationKey, async (c) => {
	const { id } = c.req.valid("param");
	await getActiveClaim(id);
	await clearClaimVerificationKey(id);
	return c.json({ verificationKeyMasked: null, verificationKeySetAt: null });
});

const updateCompanySettings = createRoute({
	method: "patch",
	path: "/airside/companies/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						website: z.string().url().max(500).nullable(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						website: z.string().nullable(),
					}),
				},
			},
			description: "The updated company.",
		},
	},
});

adminAirside.openapi(updateCompanySettings, async (c) => {
	const { id } = c.req.valid("param");
	const { website } = c.req.valid("json");
	const [updated] = await db
		.update(tables.providerCompany)
		.set({ website })
		.where(eq(tables.providerCompany.id, id))
		.returning({
			id: tables.providerCompany.id,
			website: tables.providerCompany.website,
		});
	if (!updated) {
		throw new HTTPException(404, { message: "Company not found" });
	}
	return c.json(updated);
});

async function getActiveCarrierClaim(providerId: string) {
	const claim = await db.query.providerClaim.findFirst({
		where: { providerId: { eq: providerId }, status: { eq: "active" } },
	});
	if (!claim) {
		throw new HTTPException(404, {
			message: "This provider has no active carrier.",
		});
	}
	return claim;
}

function routingScope(providerId: string, modelId: string | null) {
	return and(
		eq(tables.providerRoutingSettings.providerId, providerId),
		modelId
			? eq(tables.providerRoutingSettings.modelId, modelId)
			: sql`${tables.providerRoutingSettings.modelId} IS NULL`,
	);
}

// A carrier filing still pending for the scope would overwrite the admin's
// fare (or recreate a removed override) once approved, so it is rejected.
function rejectPendingFilings(
	tx: Pick<typeof db, "update">,
	providerId: string,
	modelId: string | null,
	userId: string | null,
	reviewNote: string,
) {
	return tx
		.update(tables.providerRoutingFiling)
		.set({
			status: "rejected",
			reviewedBy: userId,
			reviewNote,
			reviewedAt: new Date(),
		})
		.where(
			and(
				eq(tables.providerRoutingFiling.providerId, providerId),
				modelId
					? eq(tables.providerRoutingFiling.modelId, modelId)
					: sql`${tables.providerRoutingFiling.modelId} IS NULL`,
				eq(tables.providerRoutingFiling.status, "pending"),
			),
		);
}

// Admin fare changes skip review, so their filing is born approved.
function adminFilingFields(userId: string | null) {
	return {
		status: "approved" as const,
		initiatedBy: "admin" as const,
		requestedBy: userId,
		reviewedBy: userId,
		reviewedAt: new Date(),
	};
}

const setRoutingSettings = createRoute({
	method: "put",
	path: "/airside/routing-settings/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// null/omitted sets the carrier default.
						modelId: z.string().min(1).max(200).nullable().optional(),
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
				"application/json": { schema: z.object({ ok: z.boolean() }) },
			},
			description: "The fare is live immediately.",
		},
	},
});

adminAirside.openapi(setRoutingSettings, async (c) => {
	const { providerId } = c.req.valid("param");
	const body = c.req.valid("json");
	const modelId = body.modelId ?? null;
	const claim = await getActiveCarrierClaim(providerId);
	if (modelId) {
		const model = await db.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: providerId },
				modelName: { eq: modelId },
				status: { eq: "active" },
			},
			columns: { id: true },
		});
		if (!model) {
			throw new HTTPException(404, { message: "Active model not found." });
		}
	}
	const values = {
		providerCompanyId: claim.providerCompanyId,
		discountPercent: String(body.discountPercent),
		marginPercent: String(body.marginPercent),
	};
	const userId = c.get("user")?.id ?? null;
	// cdb: the gateway prices the routing election from provider_routing_settings.
	await cdb.transaction(async (tx) => {
		await rejectPendingFilings(
			tx,
			providerId,
			modelId,
			userId,
			"Superseded by an admin fare change.",
		);
		const updated = await tx
			.update(tables.providerRoutingSettings)
			.set(values)
			.where(routingScope(providerId, modelId))
			.returning({ id: tables.providerRoutingSettings.id });
		if (updated.length === 0) {
			await tx
				.insert(tables.providerRoutingSettings)
				.values({ ...values, providerId, modelId });
		}
		await tx.insert(tables.providerRoutingFiling).values({
			...values,
			...adminFilingFields(userId),
			providerId,
			modelId,
		});
	});
	return c.json({ ok: true });
});

const deleteRoutingOverride = createRoute({
	method: "delete",
	path: "/airside/routing-settings/{providerId}/override",
	request: {
		params: z.object({ providerId: z.string() }),
		query: z.object({ modelId: z.string().min(1) }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ ok: z.boolean() }) },
			},
			description: "The model falls back to the carrier default fare.",
		},
	},
});

adminAirside.openapi(deleteRoutingOverride, async (c) => {
	const { providerId } = c.req.valid("param");
	const { modelId } = c.req.valid("query");
	const userId = c.get("user")?.id ?? null;
	await cdb.transaction(async (tx) => {
		const deleted = await tx
			.delete(tables.providerRoutingSettings)
			.where(routingScope(providerId, modelId))
			.returning();
		if (deleted.length === 0) {
			throw new HTTPException(404, { message: "Override not found" });
		}
		await rejectPendingFilings(
			tx,
			providerId,
			modelId,
			userId,
			"Superseded by an admin override removal.",
		);
		const [fallback] = await tx
			.select()
			.from(tables.providerRoutingSettings)
			.where(routingScope(providerId, null))
			.limit(1);
		// Record the default fare the model now inherits.
		await tx.insert(tables.providerRoutingFiling).values({
			...adminFilingFields(userId),
			providerCompanyId: deleted[0].providerCompanyId,
			providerId,
			modelId,
			discountPercent: fallback?.discountPercent ?? "0",
			marginPercent: fallback?.marginPercent ?? String(AIRSIDE_BASELINE_MARGIN),
			clearsOverride: true,
		});
	});
	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Listing invite codes — minted here, redeemed in the carrier onboarding to
// skip the listing fee.
// ---------------------------------------------------------------------------

const adminInviteCodeSchema = z.object({
	id: z.string(),
	code: z.string(),
	note: z.string().nullable(),
	maxUses: z.number(),
	usedCount: z.number(),
	revokedAt: z.string().nullable(),
	createdAt: z.string(),
	// Companies that redeemed this code.
	redeemedBy: z.array(z.object({ id: z.string(), name: z.string() })),
});

// No ambiguous characters (0/O, 1/I/L) — codes get read out loud.
const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateInviteCode(): string {
	const bytes = randomBytes(8);
	const chars = Array.from(bytes, (byte) =>
		INVITE_CODE_ALPHABET.charAt(byte % INVITE_CODE_ALPHABET.length),
	);
	return `AIR-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

function serializeInviteCode(
	row: typeof tables.airsideInviteCode.$inferSelect,
	redeemedBy: { id: string; name: string }[],
) {
	return {
		id: row.id,
		code: row.code,
		note: row.note,
		maxUses: row.maxUses,
		usedCount: row.usedCount,
		revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		redeemedBy,
	};
}

const listInviteCodes = createRoute({
	method: "get",
	path: "/airside/invite-codes",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(200).default(200).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						codes: z.array(adminInviteCodeSchema),
						total: z.number(),
					}),
				},
			},
			description: "Listing invite codes, newest first.",
		},
	},
});

adminAirside.openapi(listInviteCodes, async (c) => {
	const query = c.req.valid("query");
	const rows = await db.query.airsideInviteCode.findMany({
		orderBy: { createdAt: "desc", id: "desc" },
		limit: query.limit ?? 200,
		offset: query.offset ?? 0,
	});
	const [totalRow] = await db
		.select({ count: count() })
		.from(tables.airsideInviteCode);
	const codes = rows.map((row) => row.code);
	const redeemers = codes.length
		? await db.query.providerCompany.findMany({
				where: { listingInviteCode: { in: codes } },
				columns: { id: true, name: true, listingInviteCode: true },
			})
		: [];
	return c.json({
		codes: rows.map((row) =>
			serializeInviteCode(
				row,
				redeemers
					.filter((company) => company.listingInviteCode === row.code)
					.map((company) => ({ id: company.id, name: company.name })),
			),
		),
		total: totalRow?.count ?? 0,
	});
});

const createInviteCode = createRoute({
	method: "post",
	path: "/airside/invite-codes",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						note: z.string().max(200).optional(),
						maxUses: z.number().int().min(1).max(100).default(1),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ code: adminInviteCodeSchema }),
				},
			},
			description: "The freshly minted invite code.",
		},
	},
});

adminAirside.openapi(createInviteCode, async (c) => {
	const user = c.get("user");
	const { note, maxUses } = c.req.valid("json");
	const [row] = await db
		.insert(tables.airsideInviteCode)
		.values({
			code: generateInviteCode(),
			note: note ?? null,
			maxUses,
			createdBy: user?.id ?? null,
		})
		.returning();
	return c.json({ code: serializeInviteCode(row, []) }, 201);
});

const revokeInviteCode = createRoute({
	method: "post",
	path: "/airside/invite-codes/{id}/revoke",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ code: adminInviteCodeSchema }),
				},
			},
			description: "The revoked code. It can no longer be redeemed.",
		},
	},
});

adminAirside.openapi(revokeInviteCode, async (c) => {
	const { id } = c.req.valid("param");
	const [row] = await db
		.update(tables.airsideInviteCode)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(tables.airsideInviteCode.id, id),
				sql`${tables.airsideInviteCode.revokedAt} IS NULL`,
			),
		)
		.returning();
	if (!row) {
		throw new HTTPException(404, {
			message: "Invite code not found or already revoked.",
		});
	}
	const redeemers = await db.query.providerCompany.findMany({
		where: { listingInviteCode: { eq: row.code } },
		columns: { id: true, name: true },
	});
	return c.json({ code: serializeInviteCode(row, redeemers) });
});
