export const DEVPASS_AUDIENCES = ["active", "past", "past-due"] as const;
export type DevPassAudience = (typeof DEVPASS_AUDIENCES)[number];

/** A paid plan purchase or renewal: the mark of someone who had DevPass. */
export const PAID_PLAN_TRANSACTION_TYPES = [
	"dev_plan_start",
	"dev_plan_renewal",
	"dev_plan_upgrade",
	"subscription_start",
] as const;

/** One member of one DevPass organization. */
export interface DevPassMembership {
	email: string;
	name: string | null;
	devPlan: string;
	cancelled: boolean;
	expiresAt: Date | null;
	hasSubscription: boolean;
	paymentStatus: "current" | "past_due";
	everPaid: boolean;
}

export function isDevPassAudience(value: string): value is DevPassAudience {
	return (DEVPASS_AUDIENCES as readonly string[]).includes(value);
}

/** A plan that still runs, including a cancelled one inside its paid period. */
function isActive(row: DevPassMembership, now: Date): boolean {
	return (
		row.devPlan !== "none" &&
		row.hasSubscription &&
		(!row.cancelled || (row.expiresAt !== null && row.expiresAt > now))
	);
}

/**
 * Who a campaign goes to, one row per address, sorted:
 * - `active`: everyone whose plan still runs.
 * - `past-due`: of those, the ones whose last renewal payment failed.
 * - `past`: people who paid for a plan once and have none now, on any of
 *   their organizations. Someone with a running plan is never won back.
 */
export function selectDevPassAudience(
	rows: ReadonlyArray<DevPassMembership>,
	audience: DevPassAudience,
	now: Date,
): DevPassMembership[] {
	const key = (row: DevPassMembership) => row.email.trim().toLowerCase();
	const active = rows.filter((row) => isActive(row, now));
	const activeEmails = new Set(active.map(key));
	const picked =
		audience === "active"
			? active
			: audience === "past-due"
				? active.filter((row) => row.paymentStatus === "past_due")
				: rows.filter(
						(row) =>
							row.devPlan === "none" &&
							row.everPaid &&
							!activeEmails.has(key(row)),
					);

	const byEmail = new Map<string, DevPassMembership>();
	for (const row of picked) {
		if (!byEmail.has(key(row))) {
			byEmail.set(key(row), row);
		}
	}
	return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}
