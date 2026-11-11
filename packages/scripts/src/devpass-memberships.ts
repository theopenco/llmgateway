import { and, db, eq, isNull, or, sql, tables } from "@llmgateway/db";

import {
	PAID_PLAN_TRANSACTION_TYPES,
	type DevPassMembership,
} from "./devpass-audiences.js";

const paidTypes = sql.join(
	PAID_PLAN_TRANSACTION_TYPES.map((type) => sql`${type}`),
	sql`, `,
);

/**
 * Every reachable member of a DevPass organization. Blocked, disabled,
 * unverified and risk-flagged accounts are left out, and a plan charge that
 * was refunded does not count as having paid.
 */
export async function loadDevPassMemberships(): Promise<DevPassMembership[]> {
	const organization = tables.organization;
	const rows = await db
		.select({
			email: tables.user.email,
			name: tables.user.name,
			devPlan: organization.devPlan,
			cancelled: organization.devPlanCancelled,
			expiresAt: organization.devPlanExpiresAt,
			subscriptionId: organization.devPlanStripeSubscriptionId,
			paymentStatus: organization.subscriptionPaymentStatus,
			everPaid: sql<boolean>`exists (
				select 1 from "transaction" paid
				where paid.organization_id = ${organization.id}
					and paid.type in (${paidTypes})
					and paid.status = 'completed'
					and not exists (
						select 1 from "transaction" refund
						where refund.organization_id = paid.organization_id
							and refund.related_transaction_id = paid.id
							and refund.type = 'credit_refund'
					)
			)`,
		})
		.from(organization)
		.innerJoin(
			tables.userOrganization,
			eq(tables.userOrganization.organizationId, organization.id),
		)
		.innerJoin(tables.user, eq(tables.user.id, tables.userOrganization.userId))
		.where(
			and(
				eq(organization.kind, "devpass"),
				or(isNull(organization.status), eq(organization.status, "active")),
				eq(organization.riskFlagged, false),
				eq(tables.user.status, "active"),
				eq(tables.user.emailVerified, true),
			),
		);
	return rows.map((row) => ({
		email: row.email,
		name: row.name,
		devPlan: row.devPlan,
		cancelled: row.cancelled,
		expiresAt: row.expiresAt,
		hasSubscription: row.subscriptionId !== null,
		paymentStatus: row.paymentStatus,
		everPaid: row.everPaid,
	}));
}
