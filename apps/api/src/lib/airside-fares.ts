import { and, eq, sql, tables } from "@llmgateway/db";

import type { CatalogueTransaction } from "@llmgateway/actions";

type RoutingFilingRow = typeof tables.providerRoutingFiling.$inferSelect;

/** Whether the carrier's active claim lets its fare changes skip review. */
export async function carrierAutoApprovesFares(
	tx: CatalogueTransaction,
	providerCompanyId: string,
	providerId: string,
): Promise<boolean> {
	const [claim] = await tx
		.select({ autoApproveFares: tables.providerClaim.autoApproveFares })
		.from(tables.providerClaim)
		.where(
			and(
				eq(tables.providerClaim.providerCompanyId, providerCompanyId),
				eq(tables.providerClaim.providerId, providerId),
				eq(tables.providerClaim.status, "active"),
			),
		)
		.limit(1)
		.$withCache(false);
	return claim?.autoApproveFares ?? false;
}

/** Write an approved fare change into the carrier's live routing settings. */
export async function applyRoutingFiling(
	tx: CatalogueTransaction,
	filing: Pick<
		RoutingFilingRow,
		| "providerId"
		| "modelId"
		| "providerCompanyId"
		| "discountPercent"
		| "marginPercent"
	>,
): Promise<void> {
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
		.limit(1)
		.$withCache(false);
	if (current) {
		await tx
			.update(tables.providerRoutingSettings)
			.set({
				providerCompanyId: filing.providerCompanyId,
				discountPercent: filing.discountPercent,
				marginPercent: filing.marginPercent,
			})
			.where(eq(tables.providerRoutingSettings.id, current.id));
		return;
	}
	await tx.insert(tables.providerRoutingSettings).values({
		providerId: filing.providerId,
		modelId: filing.modelId,
		providerCompanyId: filing.providerCompanyId,
		discountPercent: filing.discountPercent,
		marginPercent: filing.marginPercent,
	});
}
