// Default team-member seat cap per plan tier. An explicit `organization.seats`
// override (set by admins) always takes precedence over these defaults.
export function resolveSeatLimit(
	plan: string | null | undefined,
	seats: number | null | undefined,
): number {
	if (seats !== null && seats !== undefined) {
		return seats;
	}
	return plan === "enterprise" ? 100 : 5;
}
