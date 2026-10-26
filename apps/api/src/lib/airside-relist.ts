import { HTTPException } from "hono/http-exception";

import { and, desc, eq, ne, tables } from "@llmgateway/db";

import { materializeAirsideModel } from "./airside-catalogue.js";
import { assertListingKind } from "./airside-decisions.js";

import type { CatalogueTransaction } from "./airside-catalogue.js";

type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;

/** Postgres unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
	const code =
		(err as { code?: string; cause?: { code?: string } })?.code ??
		(err as { cause?: { code?: string } })?.cause?.code;
	return code === "23505";
}

/**
 * Locks the active claim and the delisted listing in the revoker's
 * claim-then-model order, so a concurrent revocation cannot commit between
 * these checks and the relist, and returns the listing with the fare it
 * would serve at.
 */
export async function lockRelistableListing(
	tx: CatalogueTransaction,
	model: { id: string; providerCompanyId: string; providerId: string },
	verify?: (locked: DraftModelRow) => Promise<void>,
) {
	const [claim] = await tx
		.select({ id: tables.providerClaim.id })
		.from(tables.providerClaim)
		.where(
			and(
				eq(tables.providerClaim.providerCompanyId, model.providerCompanyId),
				eq(tables.providerClaim.providerId, model.providerId),
				eq(tables.providerClaim.status, "active"),
			),
		)
		.for("update")
		.$withCache(false);
	if (!claim) {
		throw new HTTPException(403, {
			message:
				"The company no longer holds an active claim on this provider, so its models cannot be relisted.",
		});
	}
	const [locked] = await tx
		.select()
		.from(tables.providerDraftModel)
		.where(eq(tables.providerDraftModel.id, model.id))
		.for("update")
		.$withCache(false);
	if (!locked || locked.status !== "delisted") {
		throw new HTTPException(409, {
			message: "Only delisted models can be relisted.",
		});
	}
	await verify?.(locked);
	await assertListingKind(locked.modelName, locked.decisions);
	const [fare] = await tx
		.select()
		.from(tables.providerPriceFiling)
		.where(
			and(
				eq(tables.providerPriceFiling.draftModelId, model.id),
				eq(tables.providerPriceFiling.status, "approved"),
			),
		)
		.orderBy(desc(tables.providerPriceFiling.createdAt))
		.limit(1)
		.$withCache(false);
	if (!fare) {
		throw new HTTPException(409, {
			message: "This model has no approved fares to relist at.",
		});
	}
	const [live] = await tx
		.select({ id: tables.providerDraftModel.id })
		.from(tables.providerDraftModel)
		.where(
			and(
				eq(tables.providerDraftModel.providerId, locked.providerId),
				eq(tables.providerDraftModel.modelName, locked.modelName),
				ne(tables.providerDraftModel.status, "delisted"),
			),
		)
		.limit(1)
		.$withCache(false);
	if (live) {
		throw new HTTPException(409, {
			message:
				"Another model with this name is already listed for the provider.",
		});
	}
	return { locked, fare };
}

/**
 * Puts an approved relist request into effect: the listing goes back into
 * service at its last approved fare.
 */
export async function relistAirsideListing(
	tx: CatalogueTransaction,
	model: { id: string; providerCompanyId: string; providerId: string },
): Promise<DraftModelRow> {
	// Re-checked under the row lock: the carrier may have withdrawn the
	// request since the caller read it.
	const { fare } = await lockRelistableListing(tx, model, async (locked) => {
		if (!locked.relistRequestedAt) {
			throw new HTTPException(409, {
				message: "This listing has no relist request under review.",
			});
		}
	});
	try {
		const [relisted] = await tx
			.update(tables.providerDraftModel)
			.set({
				status: "active",
				delistedAt: null,
				delistReason: null,
				pausedAt: null,
				relistRequestedAt: null,
				relistRequestedBy: null,
				relistReviewedAt: null,
				relistReviewNote: null,
			})
			.where(eq(tables.providerDraftModel.id, model.id))
			.returning();
		await materializeAirsideModel(relisted, fare, tx);
		return relisted;
	} catch (err) {
		// The partial unique index on live (provider, model) rows rejects a
		// relist while another listing holds the name.
		if (isUniqueViolation(err)) {
			throw new HTTPException(409, {
				message:
					"Another model with this name is already listed for the provider.",
			});
		}
		throw err;
	}
}
