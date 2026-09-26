export function accountBlockMessage(
	reason: string | null | undefined,
	fallback = "Your account has been deactivated. Please contact support.",
): string {
	return reason?.trim()
		? `Your account has been blocked. Reason: ${reason.trim()}`
		: fallback;
}
