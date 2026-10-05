import { HTTPException } from "hono/http-exception";

import {
	decryptClaimVerificationKey,
	encryptProviderKeyForStorage,
	readProviderKey,
	redactToken,
	runProviderKeySmokeTest,
} from "@llmgateway/actions";
import { and, db, eq, isNull, shortid, tables } from "@llmgateway/db";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { cdb, ProviderModelVerificationTarget } from "@llmgateway/db";

type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;
type CacheTransaction = Parameters<Parameters<typeof cdb.transaction>[0]>[0];

// A custom carrier hands us two keys: the provider key we serve its traffic
// with, and a testing key for preflight runs. Test traffic is neither logged
// nor billed by us, so it must land on a different account than production.
const SEPARATE_KEYS_MESSAGE =
	"Use two different keys: the testing key runs preflight checks, the provider key serves your traffic.";

/** Compare-and-set guard on the claim's pending provider key pointer. */
export function pendingProviderKeyIs(id: string | null) {
	return id
		? eq(tables.providerClaim.pendingProviderKeyId, id)
		: isNull(tables.providerClaim.pendingProviderKeyId);
}

/**
 * Files a carrier's provider key for admin approval: stored encrypted and
 * inactive, replacing any submission still awaiting review. Callers must have
 * smoke-tested it first. Run inside a cdb transaction — managed provider_key
 * rows feed the gateway's credential cache.
 */
export async function fileProviderKey(
	tx: CacheTransaction,
	claim: ProviderClaimRow,
	apiKey: string,
) {
	const id = shortid();
	const [key] = await tx
		.insert(tables.providerKey)
		.values({
			id,
			provider: claim.providerId,
			managed: true,
			organizationId: null,
			status: "inactive",
			comment: "Submitted by the carrier in Airside",
			...encryptProviderKeyForStorage(apiKey, id, null),
			// Prefix and suffix, like the testing key, so a carrier and a
			// reviewer can tell a replacement from the key it replaces.
			tokenMasked: maskToken(apiKey, 6, 4),
		})
		.returning();
	if (claim.pendingProviderKeyId) {
		await tx
			.update(tables.providerKey)
			.set({ status: "deleted" })
			.where(eq(tables.providerKey.id, claim.pendingProviderKeyId));
	}
	const updated = await tx
		.update(tables.providerClaim)
		.set({ pendingProviderKeyId: id })
		.where(
			and(
				eq(tables.providerClaim.id, claim.id),
				pendingProviderKeyIs(claim.pendingProviderKeyId),
			),
		)
		.returning({ id: tables.providerClaim.id });
	if (updated.length === 0) {
		throw new HTTPException(409, {
			message: "Your provider key changed in the meantime — reload and retry.",
		});
	}
	return {
		masked: key.tokenMasked ?? "",
		submittedAt: key.createdAt.toISOString(),
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

/**
 * The carrier's most recently submitted listing, live or in review — every
 * one passed preflight, so its mapping is a fair smoke-test target.
 */
export async function latestListing(claim: ProviderClaimRow) {
	return await db.query.providerDraftModel.findFirst({
		where: {
			providerCompanyId: { eq: claim.providerCompanyId },
			providerId: { eq: claim.providerId },
			status: { ne: "delisted" },
		},
		columns: { modelName: true, externalId: true, apiFormat: true },
		orderBy: { createdAt: "desc" },
	});
}
