import { HTTPException } from "hono/http-exception";

import { db, drizzleCache, eq, tables } from "@llmgateway/db";

export type OrganizationTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];
export type CapacityTransaction = OrganizationTransaction;
type Organization = typeof tables.organization.$inferSelect;

export async function lockOrganizationBilling(
	tx: OrganizationTransaction,
	organizationId: string,
): Promise<void> {
	await tx
		.insert(tables.organizationBillingOperation)
		.values({ organizationId })
		.onConflictDoNothing();
	await tx
		.select({
			organizationId: tables.organizationBillingOperation.organizationId,
		})
		.from(tables.organizationBillingOperation)
		.where(
			eq(tables.organizationBillingOperation.organizationId, organizationId),
		)
		.for("update");
}

export async function withBillingOperation<T>(
	organizationId: string,
	mutation: (
		tx: OrganizationTransaction,
		organization: Organization,
	) => Promise<T>,
): Promise<T> {
	const result = await db.transaction(async (tx) => {
		// Serialize external billing without locking the balance row during network I/O.
		await lockOrganizationBilling(tx, organizationId);
		const organization = await tx.query.organization.findFirst({
			where: { id: { eq: organizationId } },
		});
		if (!organization || organization.status === "deleted") {
			throw new HTTPException(404, { message: "Organization not found" });
		}
		return await mutation(tx, organization);
	});
	await drizzleCache.onMutate({ tables: ["organization", "transaction"] });
	return result;
}
