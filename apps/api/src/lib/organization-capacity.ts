import { HTTPException } from "hono/http-exception";

import { db, drizzleCache, eq, tables } from "@llmgateway/db";

export type CapacityTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];
type Organization = typeof tables.organization.$inferSelect;

export async function withOrganizationCapacity<T>(
	organizationId: string,
	mutation: (tx: CapacityTransaction, organization: Organization) => Promise<T>,
): Promise<T> {
	const result = await db.transaction(async (tx) => {
		const [organization] = await tx
			.select()
			.from(tables.organization)
			.where(eq(tables.organization.id, organizationId))
			.for("no key update");
		if (!organization || organization.status === "deleted") {
			throw new HTTPException(404, { message: "Organization not found" });
		}
		return await mutation(tx, organization);
	});
	await drizzleCache.onMutate({
		tables: [
			"organization",
			"organization_invite",
			"user_organization",
			"api_key",
			"project",
		],
	});
	return result;
}
