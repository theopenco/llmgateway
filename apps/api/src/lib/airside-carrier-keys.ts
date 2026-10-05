import { HTTPException } from "hono/http-exception";

import {
	decryptClaimVerificationKey,
	encryptProviderKeyForStorage,
	readProviderKey,
	redactToken,
	runProviderKeySmokeTest,
} from "@llmgateway/actions";
import { db } from "@llmgateway/db";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { ProviderModelVerificationTarget, tables } from "@llmgateway/db";

type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;

// A custom carrier hands us two keys: the provider key we serve its traffic
// with, and a testing key for preflight runs. Test traffic is neither logged
// nor billed by us, so it must land on a different account than production.
const SEPARATE_KEYS_MESSAGE =
	"Use two different keys: the testing key runs preflight checks, the provider key serves your traffic.";

/** Insert values for a carrier-submitted provider key, inactive until approved. */
export function carrierProviderKeyValues(apiKey: string, id: string) {
	return {
		id,
		managed: true,
		organizationId: null,
		status: "inactive" as const,
		comment: "Submitted by the carrier in Airside",
		...encryptProviderKeyForStorage(apiKey, id, null),
		// Prefix and suffix, like the testing key, so a carrier and a reviewer
		// can tell a replacement from the key it replaces.
		tokenMasked: maskToken(apiKey, 6, 4),
	};
}

async function carrierProviderKeyTokens(
	claim: ProviderClaimRow,
): Promise<string[]> {
	const ids = [claim.providerKeyId, claim.pendingProviderKeyId].filter(
		(id): id is string => id !== null,
	);
	if (ids.length === 0) {
		return [];
	}
	const rows = await db.query.providerKey.findMany({
		where: { id: { in: ids } },
	});
	return rows.map((row) => readProviderKey(row));
}

export async function assertTestingKeyIsSeparate(
	claim: ProviderClaimRow,
	testingKey: string,
): Promise<void> {
	if ((await carrierProviderKeyTokens(claim)).includes(testingKey)) {
		throw new HTTPException(400, { message: SEPARATE_KEYS_MESSAGE });
	}
}

export async function assertProviderKeyIsSeparate(
	claim: ProviderClaimRow,
	providerKey: string,
): Promise<void> {
	const testingKey = claim.verificationKeyCiphertext
		? decryptClaimVerificationKey(
				claim.verificationKeyCiphertext,
				claim.id,
				claim.providerCompanyId,
			)
		: null;
	if (providerKey === testingKey) {
		throw new HTTPException(400, { message: SEPARATE_KEYS_MESSAGE });
	}
	if ((await carrierProviderKeyTokens(claim)).includes(providerKey)) {
		throw new HTTPException(400, {
			message: "This key is already on file as your provider key.",
		});
	}
}

export function assertDistinctRegistrationKeys(
	providerKey: string,
	testingKey: string,
): void {
	if (providerKey === testingKey) {
		throw new HTTPException(400, { message: SEPARATE_KEYS_MESSAGE });
	}
}

/**
 * Proves a provider key can serve a listing: one basic completion against the
 * carrier's endpoint, in the listing's own API format. Run before anything
 * reaches review, so a broken key never costs a review round trip.
 */
export async function assertProviderKeyServes(
	claim: ProviderClaimRow,
	apiKey: string,
	target: ProviderModelVerificationTarget,
): Promise<void> {
	const failure = await runProviderKeySmokeTest({
		target,
		token: apiKey,
		baseUrl: claim.customBaseUrl ?? undefined,
		skipEnvVars: true,
	});
	if (failure) {
		throw new HTTPException(400, {
			message: `The provider key failed a smoke test against ${target.modelName}: ${redactToken(failure, apiKey)}`,
		});
	}
}

/** The carrier's most recently listed live model, if any. */
export async function latestActiveListing(claim: ProviderClaimRow) {
	return await db.query.providerDraftModel.findFirst({
		where: {
			providerCompanyId: { eq: claim.providerCompanyId },
			providerId: { eq: claim.providerId },
			status: { eq: "active" },
		},
		columns: { modelName: true, externalId: true, apiFormat: true },
		orderBy: { createdAt: "desc" },
	});
}
