/**
 * Operator-facing name of a managed provider key. Providers routinely have
 * several managed keys and the token is masked, so the admin note is what
 * tells them apart; the mask is the fallback.
 */
export function managedProviderKeyName(key: {
	comment: string | null;
	tokenMasked: string;
}): string {
	return key.comment?.trim() || key.tokenMasked;
}
