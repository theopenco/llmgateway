/**
 * Plan term helpers shared by the dashboard and the admin panel.
 *
 * An enterprise plan is sold as a contract term rather than a rolling
 * subscription, so both surfaces need the same answer to "how long is left?".
 * Keeping the arithmetic here means the customer-facing countdown and the
 * internal one can never drift apart by a day.
 */

/** A contract term with this many days left or fewer is close enough to flag. */
export const PLAN_TERM_EXPIRING_DAYS = 30;

/** A contract term with this many days left or fewer needs attention now. */
export const PLAN_TERM_CRITICAL_DAYS = 7;

/** A deployment license with this many days left or fewer is close to expiry. */
export const ENTERPRISE_LICENSE_EXPIRING_DAYS = 90;

/** A deployment license with this many days left or fewer needs attention now. */
export const ENTERPRISE_LICENSE_CRITICAL_DAYS = 30;

/**
 * Trials run 30 days, so the contract thresholds would paint one amber from
 * the very first day. These are scaled to the shorter window instead.
 */
export const TRIAL_TERM_EXPIRING_DAYS = 7;
export const TRIAL_TERM_CRITICAL_DAYS = 3;

/** Default length of an enterprise trial, in days, when no other is chosen. */
export const ENTERPRISE_TRIAL_DAYS = 30;

/** Trial lengths offered as one-click choices when booking a trial. */
export const ENTERPRISE_TRIAL_DAY_PRESETS = [7, 14, 30, 60, 90];

/** Increments offered for extending a trial that is already running. */
export const TRIAL_EXTENSION_DAY_PRESETS = [7, 14, 30];

export type PlanTermStatus = "active" | "expiring" | "critical" | "expired";

export interface PlanTermThresholds {
	expiring: number;
	critical: number;
}

export interface PlanTerm {
	expiresAt: Date;
	/** Null when the term start was never recorded (older rows, Stripe plans). */
	startedAt: Date | null;
	/** Whole calendar days until expiry; 0 on the expiry day, negative after. */
	daysLeft: number;
	status: PlanTermStatus;
	/** Length of the term in whole days, or null without a start date. */
	totalDays: number | null;
	/** How much of the term has elapsed, 0–1, or null without a start date. */
	elapsedFraction: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
	if (!value) {
		return null;
	}
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Days are counted between UTC midnights rather than as elapsed hours, so a
 * term expiring "tomorrow" reads as 1 day left all day today instead of
 * flipping to 0 partway through the afternoon.
 */
function utcMidnight(date: Date): number {
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Adds whole days to a YYYY-MM-DD calendar date, staying in UTC. */
export function addCalendarDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day + days))
		.toISOString()
		.slice(0, 10);
}

/**
 * The new end date for a trial being extended by `days`.
 *
 * A running trial is extended from its own end date, so "+7 days" on a trial
 * with 10 days left leaves 17. A trial that has already lapsed is extended from
 * today instead: extending one that ended a month ago by a week would otherwise
 * still land in the past and look like the button did nothing.
 */
export function extendTrialEnd(
	currentEnd: string | null | undefined,
	days: number,
	today: string,
): string {
	const base = currentEnd && currentEnd > today ? currentEnd : today;
	return addCalendarDays(base, days);
}

export function getPlanTerm(input: {
	expiresAt: Date | string | null | undefined;
	startedAt?: Date | string | null | undefined;
	now?: Date;
	thresholds?: PlanTermThresholds;
}): PlanTerm | null {
	const expiresAt = toDate(input.expiresAt);
	if (!expiresAt) {
		return null;
	}

	const now = input.now ?? new Date();
	const startedAt = toDate(input.startedAt);

	const daysLeft = Math.round(
		(utcMidnight(expiresAt) - utcMidnight(now)) / MS_PER_DAY,
	);

	const thresholds = input.thresholds ?? {
		expiring: PLAN_TERM_EXPIRING_DAYS,
		critical: PLAN_TERM_CRITICAL_DAYS,
	};

	let status: PlanTermStatus;
	if (daysLeft < 0) {
		status = "expired";
	} else if (daysLeft <= thresholds.critical) {
		status = "critical";
	} else if (daysLeft <= thresholds.expiring) {
		status = "expiring";
	} else {
		status = "active";
	}

	let totalDays: number | null = null;
	let elapsedFraction: number | null = null;
	if (startedAt && startedAt.getTime() < expiresAt.getTime()) {
		const span = expiresAt.getTime() - startedAt.getTime();
		totalDays = Math.round(
			(utcMidnight(expiresAt) - utcMidnight(startedAt)) / MS_PER_DAY,
		);
		elapsedFraction = Math.min(
			1,
			Math.max(0, (now.getTime() - startedAt.getTime()) / span),
		);
	}

	return { expiresAt, startedAt, daysLeft, status, totalDays, elapsedFraction };
}

export function getEnterpriseLicenseTerm(
	expiresAt: Date | string | null | undefined,
	now?: Date,
): PlanTerm | null {
	return getPlanTerm({
		expiresAt,
		now,
		thresholds: {
			expiring: ENTERPRISE_LICENSE_EXPIRING_DAYS,
			critical: ENTERPRISE_LICENSE_CRITICAL_DAYS,
		},
	});
}

/** Sentence-style countdown, e.g. "12 days left" or "Expired 3 days ago". */
export function formatPlanTermLabel(term: PlanTerm): string {
	const { daysLeft } = term;
	if (daysLeft < 0) {
		const days = Math.abs(daysLeft);
		return days === 1 ? "Expired yesterday" : `Expired ${days} days ago`;
	}
	if (daysLeft === 0) {
		return "Expires today";
	}
	if (daysLeft === 1) {
		return "1 day left";
	}
	return `${daysLeft} days left`;
}

/** Badge-style countdown for dense surfaces, e.g. "12d left" or "Expired". */
export function formatPlanTermBadge(term: PlanTerm): string {
	const { daysLeft } = term;
	if (daysLeft < 0) {
		return "Expired";
	}
	if (daysLeft === 0) {
		return "Last day";
	}
	return `${daysLeft}d left`;
}

/**
 * The term an organization is actually living in right now.
 *
 * An active trial always wins over the contract dates: while a trial runs, the
 * trial end is the date that decides whether the customer keeps their
 * enterprise features, so that is the countdown both surfaces must show.
 * Returns null for organizations with neither a trial nor a plan term.
 *
 * A contract term needs **both** dates. `planExpiresAt` predates this feature
 * and is also written by Stripe as the renewal date of a legacy Pro
 * subscription, so an organization later moved to enterprise can be carrying
 * one that nobody booked as an agreement. `planStartedAt` is new, is never
 * backfilled, and is only ever written next to an expiry by an admin, so
 * requiring the pair is what stops a long-standing enterprise plan from
 * spontaneously announcing that it has expired. A trial needs no such guard:
 * `isTrialActive` has never been set by anything but the admin panel.
 */
export function getOrganizationTerm(input: {
	isTrialActive?: boolean | null;
	trialStartDate?: Date | string | null;
	trialEndDate?: Date | string | null;
	planStartedAt?: Date | string | null;
	planExpiresAt?: Date | string | null;
	now?: Date;
}): { kind: "trial" | "contract"; term: PlanTerm } | null {
	if (input.isTrialActive && input.trialEndDate) {
		const term = getPlanTerm({
			expiresAt: input.trialEndDate,
			startedAt: input.trialStartDate,
			now: input.now,
			thresholds: {
				expiring: TRIAL_TERM_EXPIRING_DAYS,
				critical: TRIAL_TERM_CRITICAL_DAYS,
			},
		});
		if (term) {
			return { kind: "trial", term };
		}
	}

	if (!input.planStartedAt || !input.planExpiresAt) {
		return null;
	}

	const term = getPlanTerm({
		expiresAt: input.planExpiresAt,
		startedAt: input.planStartedAt,
		now: input.now,
	});

	return term ? { kind: "contract", term } : null;
}
