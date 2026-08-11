// Default team-member seat cap per plan tier. An explicit `organization.seats`
// override (set by admins) always takes precedence, followed by the seat
// quantity purchased on a self-serve Pro subscription (`proSeats`). Legacy
// flat-fee Pro subscribers have no `proSeats` and keep the historical default.
export function resolveSeatLimit(
	org:
		| {
				plan: string | null;
				seats: number | null;
				proSeats: number | null;
		  }
		| null
		| undefined,
): number {
	if (org?.seats !== null && org?.seats !== undefined) {
		return org.seats;
	}
	if (
		org?.plan === "pro" &&
		org.proSeats !== null &&
		org.proSeats !== undefined
	) {
		return org.proSeats;
	}
	return org?.plan === "enterprise" ? 100 : 5;
}
