const creditsFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

/**
 * Mirrors the server-side `assertOrganizationDeletable` guard in
 * `apps/api/src/routes/admin.ts`: an organization that still holds credits is a
 * paying customer and has to be handled manually instead of being deleted from
 * the admin panel.
 *
 * This is a UI convenience only — the API re-checks the balance and rejects the
 * disable/block/bulk-block endpoints with HTTP 409 regardless of what the
 * dashboard renders.
 *
 * Returns the reason deletion is blocked, or null when the organization may be
 * deleted.
 */
export function getOrgDeletionBlockedReason(
	credits: string | null | undefined,
): string | null {
	const parsed = Number(credits ?? "0");

	// `!(parsed <= 0)` rather than `parsed > 0` so an unparseable balance (NaN)
	// also blocks: refusing to delete is the safe direction.
	if (!(parsed <= 0)) {
		return `Organization still has a positive credit balance (${
			Number.isFinite(parsed)
				? creditsFormatter.format(parsed)
				: (credits ?? "unknown")
		}). Zero out or refund it first, then handle this account manually.`;
	}

	return null;
}
