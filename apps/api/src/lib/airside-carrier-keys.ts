import { HTTPException } from "hono/http-exception";

import {
	encryptProviderKeyForStorage,
	readProviderKey,
	redactToken,
	runProviderKeySmokeTest,
	createAirsideGatewayFetch,
	airsideInferencePricing,
} from "@llmgateway/actions";
import { and, cdb, db, eq, isNull, shortid, tables } from "@llmgateway/db";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;
type CacheTransaction = Parameters<Parameters<typeof cdb.transaction>[0]>[0];

// Carrier checks use the same provider credential as live traffic.

/** Compare-and-set guard on the claim's pending provider key pointer. */
function pendingProviderKeyIs(id: string | null) {
	return id
		? eq(tables.providerClaim.pendingProviderKeyId, id)
		: isNull(tables.providerClaim.pendingProviderKeyId);
}

/** Files an encrypted provider key for review; replacement keys are smoke-tested before linking. */
export async function fileProviderKey(
	tx: CacheTransaction,
	claim: ProviderClaimRow,
	apiKey: string,
	storedKey?: typeof tables.providerKey.$inferSelect,
) {
	const key = storedKey ?? (await storeCarrierProviderKey(tx, claim, apiKey));
	const id = key.id;
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
				claim.providerKeyId
					? eq(tables.providerClaim.providerKeyId, claim.providerKeyId)
					: isNull(tables.providerClaim.providerKeyId),
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

/**
 * Drops a carrier's provider key awaiting review. The pointer moves first:
 * if approval promoted the key in the meantime, nothing is deleted.
 */
export async function discardPendingProviderKey(
	claim: ProviderClaimRow,
	keyId: string,
): Promise<void> {
	// A carrier's first key is reviewed with its first model; dropping it
	// would let that model go live with nothing to serve it.
	if (!claim.providerKeyId) {
		throw new HTTPException(409, {
			message:
				"The first provider key is reviewed with the first model — replace it instead.",
		});
	}
	// cdb: managed provider_key rows feed the gateway's credential cache.
	await cdb.transaction(async (tx) => {
		const cleared = await tx
			.update(tables.providerClaim)
			.set({ pendingProviderKeyId: null })
			.where(
				and(
					eq(tables.providerClaim.id, claim.id),
					eq(tables.providerClaim.pendingProviderKeyId, keyId),
				),
			)
			.returning({ id: tables.providerClaim.id });
		if (cleared.length === 0) {
			throw new HTTPException(409, {
				message: "The provider key changed in the meantime — reload.",
			});
		}
		await tx
			.update(tables.providerKey)
			.set({ status: "deleted" })
			.where(eq(tables.providerKey.id, keyId));
	});
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

export async function assertProviderKeyIsSeparate(
	claim: ProviderClaimRow,
	providerKey: string,
): Promise<void> {
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
	incomingHeaders?: HeadersInit,
	providerKeyId?: string,
): Promise<void> {
	const mapping = await db.query.modelProviderMapping.findFirst({
		where: {
			providerId: { eq: target.providerId },
			modelId: { eq: target.modelName },
			externalId: { eq: target.externalId },
			status: { eq: "active" },
			region: target.region ? { eq: target.region } : { isNull: true },
		},
	});
	const listing = await db.query.providerDraftModel.findFirst({
		where: {
			providerCompanyId: { eq: claim.providerCompanyId },
			providerId: { eq: target.providerId },
			modelName: { eq: target.modelName },
			externalId: { eq: target.externalId },
		},
	});
	const filing = listing
		? await db.query.providerPriceFiling.findFirst({
				where: {
					draftModelId: { eq: listing.id },
					status: { in: ["pending", "approved"] },
				},
				orderBy: { createdAt: "desc" },
			})
		: undefined;
	const pricing = mapping ?? filing ?? target.pricing;
	if (
		!pricing ||
		typeof pricing.inputPrice !== "string" ||
		typeof pricing.outputPrice !== "string"
	) {
		throw new HTTPException(503, {
			message: "Provider verification pricing is not configured.",
		});
	}
	let infrastructureError: Error | undefined;
	const failure = await runProviderKeySmokeTest({
		target,
		token: apiKey,
		baseUrl: claim.customBaseUrl ?? undefined,
		skipEnvVars: true,
		fetchImplementation: createAirsideGatewayFetch({
			runId: `provider-key:${providerKeyId ?? shortid()}`,
			providerKeyId,
			onInfrastructureError: (error) => {
				infrastructureError = error;
			},
			target,
			pricing: airsideInferencePricing(
				target,
				mapping,
				mapping ? undefined : filing,
			),
			incomingHeaders,
		}),
	});
	if (infrastructureError) {
		throw new HTTPException(503, {
			message:
				"The verification gateway is unavailable. Retry after its configuration is restored.",
		});
	}
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
		columns: {
			modelName: true,
			externalId: true,
			apiFormat: true,
			decisions: true,
		},
		orderBy: { createdAt: "desc" },
	});
}
async function storeCarrierProviderKey(
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
			carrierSubmitted: true,
			...encryptProviderKeyForStorage(apiKey, id, null),
			tokenMasked: maskToken(apiKey, 6, 4),
		})
		.returning();
	return key;
}
export async function fileVerifiedProviderKey(
	claim: ProviderClaimRow,
	apiKey: string,
	target: ProviderModelVerificationTarget,
	incomingHeaders: HeadersInit,
) {
	const key = await cdb.transaction(
		async (tx) => await storeCarrierProviderKey(tx, claim, apiKey),
	);
	try {
		await assertProviderKeyServes(
			claim,
			apiKey,
			target,
			incomingHeaders,
			key.id,
		);
		return await cdb.transaction(
			async (tx) => await fileProviderKey(tx, claim, apiKey, key),
		);
	} catch (error) {
		await cdb
			.update(tables.providerKey)
			.set({ status: "deleted" })
			.where(
				and(
					eq(tables.providerKey.id, key.id),
					eq(tables.providerKey.status, "inactive"),
				),
			);
		throw error;
	}
}
