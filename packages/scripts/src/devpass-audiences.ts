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

export interface SendArgs {
	audience: DevPassAudience;
	subject: string | undefined;
	bodyPath: string | undefined;
	dryRun: boolean;
}

/**
 * Reads the script's flags and rejects anything it does not know. A mistyped
 * flag must stop the run: falling back to the default audience would send a
 * win-back to every current subscriber.
 */
export function parseSendArgs(argv: ReadonlyArray<string>): SendArgs {
	const args: SendArgs = {
		audience: "active",
		subject: undefined,
		bodyPath: undefined,
		dryRun: false,
	};
	for (const arg of argv) {
		if (arg === "--") {
			continue;
		}
		const separator = arg.indexOf("=");
		const name = separator === -1 ? arg : arg.slice(0, separator);
		const value = separator === -1 ? undefined : arg.slice(separator + 1);
		if (name === "--dry-run" && value === undefined) {
			args.dryRun = true;
		} else if (name === "--audience" && value && isDevPassAudience(value)) {
			args.audience = value;
		} else if (name === "--audience") {
			throw new Error(
				`--audience must be written as --audience=<name>, one of: ${DEVPASS_AUDIENCES.join(", ")}`,
			);
		} else if (name === "--subject" && value) {
			args.subject = value;
		} else if (name === "--body" && value) {
			args.bodyPath = value;
		} else {
			throw new Error(`Unknown or incomplete argument: ${arg}`);
		}
	}
	return args;
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
