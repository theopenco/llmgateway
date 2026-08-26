/**
 * How close a scheduled deactivation has to be for operational "soon" states.
 */
export const DEACTIVATION_NOTICE_DAYS = 30;

/** How close a deactivation has to be before the models directory warns. */
export const MODEL_DEACTIVATION_NOTICE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A provider mapping only counts as deactivated once its deactivation date has
 * passed — a future date is a scheduled deactivation and the mapping is still
 * routable, so it stays visible in public model lists.
 */
export function isMappingDeactivated(
	mapping: { deactivatedAt?: Date | string | null },
	now: Date = new Date(),
): boolean {
	return Boolean(
		mapping.deactivatedAt && new Date(mapping.deactivatedAt) <= now,
	);
}

/**
 * True while the mapping is still live but its scheduled deactivation falls
 * inside the notice window. Such a mapping is fully routable — only how its
 * status is displayed changes, so callers must never use this to filter.
 */
export function isDeactivationScheduledSoon(
	mapping: { deactivatedAt?: Date | string | null },
	now: Date = new Date(),
	withinDays: number = DEACTIVATION_NOTICE_DAYS,
): boolean {
	if (!mapping.deactivatedAt) {
		return false;
	}
	const deactivatedAt = new Date(mapping.deactivatedAt);
	return (
		deactivatedAt > now &&
		deactivatedAt.getTime() - now.getTime() <= withinDays * DAY_MS
	);
}

/**
 * True when a deactivation deserves a warning: it has already happened or is
 * scheduled inside the notice window.
 */
export function shouldShowDeactivationNotice(
	mapping: { deactivatedAt?: Date | string | null },
	now: Date = new Date(),
	withinDays: number = MODEL_DEACTIVATION_NOTICE_DAYS,
): boolean {
	return (
		isMappingDeactivated(mapping, now) ||
		isDeactivationScheduledSoon(mapping, now, withinDays)
	);
}
