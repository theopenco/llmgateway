import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	dematerializeAirsideModel,
	materializeAirsideModel,
	updateAirsideMappingPrices,
} from "@/lib/airside-catalogue.js";
import { verifiedWebsiteDomain } from "@/lib/airside-domains.js";
import { adminMiddleware } from "@/middleware/admin.js";

import { and, cdb, db, eq, inArray, ne, tables } from "@llmgateway/db";
import { models as catalogueModels } from "@llmgateway/models";

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
	kind: z.enum(["initial", "update"]),
	status: z.enum(["pending", "approved", "rejected"]),
	inputPrice: z.string(),
	outputPrice: z.string(),
	cachedInputPrice: z.string().nullable(),
	requestPrice: z.string().nullable(),
	note: z.string().nullable(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
	model: z.object({
		id: z.string(),
		providerId: z.string(),
		modelName: z.string(),
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
		})
		.nullable(),
});

type FilingWithRelations = typeof tables.providerPriceFiling.$inferSelect & {
	draftModel: typeof tables.providerDraftModel.$inferSelect & {
		priceFilings?: (typeof tables.providerPriceFiling.$inferSelect)[];
	};
	providerCompany: typeof tables.providerCompany.$inferSelect;
};

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
		note: row.note,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		model: {
			id: row.draftModel.id,
			providerId: row.draftModel.providerId,
			modelName: row.draftModel.modelName,
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
			? { inputPrice: approved.inputPrice, outputPrice: approved.outputPrice }
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
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						filings: z.array(adminFilingSchema),
						pendingCount: z.number(),
					}),
				},
			},
			description: "Airside price filings, oldest pending first.",
		},
	},
});

adminAirside.openapi(listFilings, async (c) => {
	const query = c.req.valid("query");
	const rows = await db.query.providerPriceFiling.findMany({
		where: query.status ? { status: { eq: query.status } } : undefined,
		with: {
			draftModel: { with: { priceFilings: true } },
			providerCompany: true,
		},
		orderBy: { createdAt: "asc" },
		limit: query.limit ?? 50,
		offset: query.offset ?? 0,
	});
	const pending = await db.query.providerPriceFiling.findMany({
		where: { status: { eq: "pending" } },
		columns: { id: true },
	});
	return c.json({
		filings: rows.map((row) =>
			serializeAdminFiling(row as FilingWithRelations),
		),
		pendingCount: pending.length,
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
			await tx
				.update(tables.providerDraftModel)
				.set({ status: "active" })
				.where(eq(tables.providerDraftModel.id, filing.draftModelId));
		}
	});
	// Approved listings join the DB catalogue: /internal/models (models
	// directory, playground selector) and /v1/models pick them up from there.
	if (filing.kind === "initial") {
		await materializeAirsideModel(filing.draftModel, filing);
	} else {
		await updateAirsideMappingPrices(filing.draftModel, filing);
	}
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

const adminClaimSchema = z.object({
	id: z.string(),
	providerId: z.string(),
	kind: z.enum(["catalogue", "custom"]),
	customName: z.string().nullable(),
	customBaseUrl: z.string().nullable(),
	matchedDomain: z.string(),
	status: z.enum(["pending", "active", "rejected", "revoked"]),
	claimedByEmail: z.string().nullable(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
	company: z.object({
		id: z.string(),
		name: z.string(),
		website: z.string().nullable(),
		// The registrable domain the company proved over DNS, if the proof
		// still covers the current website. A reviewer weighs a claim very
		// differently when the company demonstrably controls the domain.
		websiteVerifiedDomain: z.string().nullable(),
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
	return {
		id: row.id,
		providerId: row.providerId,
		kind: row.kind,
		customName: row.customName,
		customBaseUrl: row.customBaseUrl,
		matchedDomain: row.matchedDomain,
		status: row.status,
		claimedByEmail: claimer?.email ?? null,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		company: {
			id: row.providerCompany.id,
			name: row.providerCompany.name,
			website: row.providerCompany.website,
			websiteVerifiedDomain: verifiedWebsiteDomain(row.providerCompany) ?? null,
		},
	};
}

const listClaims = createRoute({
	method: "get",
	path: "/airside/claims",
	request: {
		query: z.object({
			status: z.enum(["pending", "active", "rejected", "revoked"]).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						claims: z.array(adminClaimSchema),
						pendingCount: z.number(),
					}),
				},
			},
			description: "Carrier claims, oldest pending first.",
		},
	},
});

adminAirside.openapi(listClaims, async (c) => {
	const query = c.req.valid("query");
	const rows = await db.query.providerClaim.findMany({
		where: query.status ? { status: { eq: query.status } } : undefined,
		with: { providerCompany: true },
		orderBy: { createdAt: "asc" },
		limit: 100,
	});
	const pending = await db.query.providerClaim.findMany({
		where: { status: { eq: "pending" } },
		columns: { id: true },
	});
	const claims = [];
	for (const row of rows) {
		claims.push(await serializeAdminClaim(row as ClaimWithRelations));
	}
	return c.json({ claims, pendingCount: pending.length });
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
		if (claim.kind === "custom") {
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
		// Read via db: cdb reads inside a transaction can serve stale cache.
		const settings = await db.query.providerRoutingSettings.findFirst({
			where: { providerId: { eq: claim.providerId } },
		});
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
	let revokedModelNames: string[] = [];
	await cdb.transaction(async (tx) => {
		const updated = await tx
			.update(tables.providerClaim)
			.set({
				status: "revoked",
				reviewedBy: user?.id ?? null,
				reviewNote: reviewNote ?? null,
				reviewedAt: new Date(),
				revokedAt: new Date(),
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
				.set({ status: "delisted", delistedAt: new Date() })
				.where(inArray(tables.providerDraftModel.id, modelIds));
			revokedModelNames = companyModels.map((m) => m.modelName);
		}
	});
	for (const modelName of revokedModelNames) {
		await dematerializeAirsideModel(claim.providerId, modelName);
	}
	if (claim.kind === "custom") {
		// The provider row only existed for this registration; drop it once no
		// catalogue mapping references it any more.
		const remaining = await db.query.modelProviderMapping.findFirst({
			where: { providerId: { eq: claim.providerId } },
			columns: { id: true },
		});
		if (!remaining) {
			await cdb
				.delete(tables.provider)
				.where(eq(tables.provider.id, claim.providerId));
		}
	}
	const updated = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
		with: { providerCompany: true },
	});
	return c.json({
		claim: await serializeAdminClaim(updated as ClaimWithRelations),
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
