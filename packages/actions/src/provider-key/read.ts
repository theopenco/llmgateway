import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { maskToken } from "@llmgateway/shared/mask-token";

import { decryptProviderKey, encryptProviderKey } from "./crypto.js";

/**
 * Minimal row shape needed for token resolution. Avoids importing the full
 * Drizzle ProviderKey type so this helper stays usable from any package.
 */
export interface ProviderKeyRowLike {
	id: string;
	organizationId: string | null;
	tokenCiphertext: string | null;
}

/**
 * AAD organization scope used for platform-managed credentials, which have no
 * owning organization. Binding them to a fixed sentinel keeps the ciphertext
 * tied to a scope that an org-owned row can never claim, so a managed
 * ciphertext cannot be replayed into an organization's key row (or vice versa).
 */
export const MANAGED_PROVIDER_KEY_ORG_SCOPE = "llmgateway:managed";

export function providerKeyEncryptionScope(
	organizationId: string | null | undefined,
): string {
	return organizationId ?? MANAGED_PROVIDER_KEY_ORG_SCOPE;
}

/**
 * Resolves the plaintext provider-key token for a row.
 */
export function readProviderKey(row: ProviderKeyRowLike): string {
	if (!row.tokenCiphertext) {
		throw new Error("Provider key ciphertext is missing");
	}

	return decryptProviderKey(
		row.tokenCiphertext,
		row.id,
		providerKeyEncryptionScope(row.organizationId),
	);
}

export function readProviderKeyMask(row: {
	tokenMasked: string | null;
}): string {
	if (!row.tokenMasked) {
		throw new Error("Provider key mask is missing");
	}

	return row.tokenMasked;
}

/** Complete encrypted-at-rest values for a provider-key insert or rotation. */
export function encryptProviderKeyForStorage(
	token: string,
	id: string,
	organizationId: string | null,
) {
	return {
		tokenCiphertext: encryptProviderKey(
			token,
			id,
			providerKeyEncryptionScope(organizationId),
		),
		tokenMasked: maskToken(token),
		tokenHash: getApiKeyFingerprint(token),
	} as const;
}

/** Row shape needed to describe a credential to the organization that owns it. */
export interface ProviderKeyLabelRowLike {
	organizationId: string | null;
	managed?: boolean | null;
	name?: string | null;
	description?: string | null;
	tokenMasked?: string | null;
}

/**
 * How a provider key is named to the organization that owns it: its
 * description when set, its custom-provider name next, then the masked token
 * the provider-keys page lists it under. Never the plaintext token.
 *
 * THE SECURITY GATE FOR CREDENTIAL LABELS LIVES HERE — do not describe a
 * provider key anywhere else. Platform-managed credentials (LLM Gateway's own
 * keys, which have no owning organization) return undefined: their name, mask
 * and comment are operator-only, and surfacing them in a tenant's routing view
 * or API response would leak platform infrastructure to every customer whose
 * request happened to fall back onto credits.
 */
export function providerKeyLabel(
	row: ProviderKeyLabelRowLike | null | undefined,
): string | undefined {
	if (!row || row.managed || !row.organizationId) {
		return undefined;
	}
	return row.description || row.name || row.tokenMasked || undefined;
}
