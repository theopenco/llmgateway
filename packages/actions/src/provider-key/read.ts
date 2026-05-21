import { decryptProviderKey } from "./crypto.js";

/**
 * Minimal row shape needed for token resolution. Avoids importing the full
 * Drizzle ProviderKey type so this helper stays usable from any package
 * that knows the three relevant columns.
 *
 * Fields are declared as `?` (optional) in addition to nullable because the
 * gateway's SWR fallback can serve cached row JSON written *before* this
 * change shipped, where the new columns simply do not exist on the object.
 * We must treat absent and null identically — see isAbsent() below.
 */
export interface ProviderKeyRowLike {
	id: string;
	organizationId: string;
	token?: string | null;
	tokenCiphertext?: string | null;
}

function isAbsent(value: string | null | undefined): value is null | undefined {
	return value === null || value === undefined;
}

/**
 * Resolves the plaintext provider-key token for a row.
 *
 * Path selection is by column nullity (treating absent fields as null),
 * not by content shape:
 *   - tokenCiphertext present  → strict crypto path (any failure throws; no fallback)
 *   - tokenCiphertext absent   → legacy plaintext path (use row.token directly)
 *   - both absent              → throw
 *
 * This is NOT a downgrade-attack vector: an attacker tampering with the
 * tokenCiphertext column value keeps the column non-null, which forces the
 * strict path and fails GCM verification rather than falling back to token.
 *
 * The absent-vs-null distinction matters for stale SWR mirrors that were
 * serialized before the schema added tokenCiphertext: those rows have no
 * such property, and we must continue to read them as legacy plaintext.
 */
export function readProviderKey(row: ProviderKeyRowLike): string {
	if (!isAbsent(row.tokenCiphertext)) {
		return decryptProviderKey(row.tokenCiphertext, row.id, row.organizationId);
	}
	if (isAbsent(row.token)) {
		throw new Error(`provider_key ${row.id}: no token available`);
	}
	return row.token;
}

/**
 * Returns true if the row carries any provider-key material, without
 * decrypting. Use this for truthiness checks where the caller only needs
 * to know whether a key exists (e.g., "is this a free-credits request?")
 * rather than its plaintext value.
 */
export function hasProviderKey(
	row: ProviderKeyRowLike | null | undefined,
): boolean {
	if (!row) {
		return false;
	}
	return !isAbsent(row.tokenCiphertext) || !isAbsent(row.token);
}
