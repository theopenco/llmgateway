import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import { db, eq, tables } from "@llmgateway/db";

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

function serializeAdminFiling(row: FilingWithRelations) {
	const approved = [...(row.draftModel.priceFilings ?? [])]
		.filter((f) => f.status === "approved")
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
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
	await db.transaction(async (tx) => {
		await tx
			.update(tables.providerPriceFiling)
			.set({
				status: "approved",
				reviewedBy: user?.id ?? null,
				reviewedAt: new Date(),
			})
			.where(eq(tables.providerPriceFiling.id, id));
		if (filing.kind === "initial") {
			await tx
				.update(tables.providerDraftModel)
				.set({ status: "active" })
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
	await db.transaction(async (tx) => {
		await tx
			.update(tables.providerPriceFiling)
			.set({
				status: "rejected",
				reviewedBy: user?.id ?? null,
				reviewNote: reviewNote ?? null,
				reviewedAt: new Date(),
			})
			.where(eq(tables.providerPriceFiling.id, id));
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
										status: z.enum(["active", "revoked"]),
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
