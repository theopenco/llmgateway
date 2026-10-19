import { and, eq, tables } from "@llmgateway/db";

import { dematerializeAirsideModel } from "./airside-catalogue.js";

import type { CatalogueTransaction } from "./airside-catalogue.js";

/**
 * Takes an active listing out of service: it stops routing, its pending
 * filings are rejected and its fare override is dropped. The carrier can
 * relist it after a passing preflight.
 */
export async function delistAirsideListing(
	tx: CatalogueTransaction,
	model: { id: string; providerId: string; modelName: string },
	reason: "removed" | "admin",
	reviewedBy: string | null = null,
): Promise<void> {
	const reviewNote =
		reason === "admin" ? "Model delisted by LLM Gateway" : "Model delisted";
	await tx
		.update(tables.providerDraftModel)
		.set({
			status: "delisted",
			delistedAt: new Date(),
			delistReason: reason,
			pausedAt: null,
		})
		.where(eq(tables.providerDraftModel.id, model.id));
	// A delisted model's pending filing would otherwise linger in the admin
	// queue and approve as a silent no-op.
	await tx
		.update(tables.providerPriceFiling)
		.set({
			status: "rejected",
			reviewedBy,
			reviewNote,
			reviewedAt: new Date(),
		})
		.where(
			and(
				eq(tables.providerPriceFiling.draftModelId, model.id),
				eq(tables.providerPriceFiling.status, "pending"),
			),
		);
	await tx
		.delete(tables.providerRoutingSettings)
		.where(
			and(
				eq(tables.providerRoutingSettings.providerId, model.providerId),
				eq(tables.providerRoutingSettings.modelId, model.modelName),
			),
		);
	await tx
		.update(tables.providerRoutingFiling)
		.set({
			status: "rejected",
			reviewedBy,
			reviewNote,
			reviewedAt: new Date(),
		})
		.where(
			and(
				eq(tables.providerRoutingFiling.providerId, model.providerId),
				eq(tables.providerRoutingFiling.modelId, model.modelName),
				eq(tables.providerRoutingFiling.status, "pending"),
			),
		);
	await dematerializeAirsideModel(model.providerId, model.modelName, tx);
}
