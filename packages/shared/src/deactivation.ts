/**
 * How close a scheduled deactivation has to be before it is worth surfacing.
 * A date further out than this is catalogue bookkeeping (providers routinely
 * publish retirement dates a year or more ahead) — the mapping routes normally
 * and nothing about it should read as "deactivated".
 */
export const DEACTIVATION_NOTICE_DAYS = 30;

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
