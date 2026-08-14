// Org-wide cap on active developer API keys. An explicit `organization.apiKeyLimit`
// override (set by admins) always takes precedence, followed by the quantities
// purchased on a self-serve Pro subscription: one included API key per seat
// plus any extra keys bought on top. Legacy flat-fee Pro subscribers have no
// `proSeats` and keep the historical default of 20.
export function resolveApiKeyLimit(
	org:
		| {
				plan: string | null;
				apiKeyLimit: number | null;
				proSeats: number | null;
				proExtraApiKeys: number | null;
		  }
		| null
		| undefined,
): number {
	if (org?.apiKeyLimit !== null && org?.apiKeyLimit !== undefined) {
		return org.apiKeyLimit;
	}
	if (
		org?.plan === "pro" &&
		org.proSeats !== null &&
		org.proSeats !== undefined
	) {
		return org.proSeats + (org.proExtraApiKeys ?? 0);
	}
	return org?.plan === "enterprise" ? 500 : org?.plan === "pro" ? 20 : 5;
}
