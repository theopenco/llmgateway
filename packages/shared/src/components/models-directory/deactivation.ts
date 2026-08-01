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
