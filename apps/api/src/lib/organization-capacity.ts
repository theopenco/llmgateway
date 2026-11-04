import { HTTPException } from "hono/http-exception";

import { lockOrganizationBilling } from "@/lib/billing-operation.js";
import { notifyOrgLimit } from "@/lib/org-limit-alerts.js";

import { db, drizzleCache, eq, tables } from "@llmgateway/db";

import type { OrgLimitEvent } from "@/lib/org-limit-alerts.js";

export type CapacityTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];
type Organization = typeof tables.organization.$inferSelect;

export async function withOrganizationCapacity<T>(
	organizationId: string,
	mutation: (
		tx: CapacityTransaction,
		organization: Organization,
		deferAlert: (event: OrgLimitEvent) => void,
	) => Promise<T>,
): Promise<T> {
	const alerts: OrgLimitEvent[] = [];
	try {
		const result = await db.transaction(async (tx) => {
			await lockOrganizationBilling(tx, organizationId);
			const [organization] = await tx
				.select()
				.from(tables.organization)
				.where(eq(tables.organization.id, organizationId))
				.for("no key update");
			if (!organization || organization.status === "deleted") {
				throw new HTTPException(404, { message: "Organization not found" });
			}
			return await mutation(tx, organization, (event) => {
				alerts.push(event);
			});
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
	} finally {
		for (const event of alerts) {
			await notifyOrgLimit(organizationId, event);
		}
	}
}
