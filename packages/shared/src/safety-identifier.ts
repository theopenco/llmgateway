import { createHmac } from "node:crypto";

import { getApiKeyHashSecret, getApiKeyHashSecrets } from "./api-key-hash.js";

const DOMAIN = "safety-identifier:org:";
const PREFIX = "lgo_";
const FORMAT = /^lgo_[0-9a-f]{64}$/;

function withSecret(organizationId: string, secret: string): string {
	const digest = createHmac("sha256", secret)
		.update(DOMAIN + organizationId)
		.digest("hex");
	return PREFIX + digest;
}

/**
 * Provider-facing abuse-attribution identifier for an organization (OpenAI
 * `safety_identifier`, Anthropic `metadata.user_id`, …). Deterministic, so
 * it is stable across API keys and key rotation; keyed, so it does not reveal
 * the organization ID. Changes only when the gateway secret rotates.
 */
export function getOrganizationSafetyIdentifier(
	organizationId: string,
): string {
	return withSecret(organizationId, getApiKeyHashSecret());
}

export function isOrganizationSafetyIdentifier(value: string): boolean {
	return FORMAT.test(value);
}

/** Whether `identifier` was issued for the organization under any keyring secret. */
export function organizationMatchesSafetyIdentifier(
	organizationId: string,
	identifier: string,
): boolean {
	return getApiKeyHashSecrets().some(
		(secret) => withSecret(organizationId, secret) === identifier,
	);
}
