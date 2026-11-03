import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
	createQueuedModelVerificationChecks,
	decryptClaimVerificationKey,
	mappingTarget,
	buildVerificationTarget,
	modelVerificationEnvironmentToken,
	narrowManagedKeysToRegion,
} from "@llmgateway/actions";
import { and, db, eq, gt, isNull, or, tables } from "@llmgateway/db";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Verification = typeof tables.providerModelVerification.$inferSelect;
const DAILY_PREFIX = "daily-verification:";

export function isDailyModelVerification(
	job: Pick<Verification, "id">,
): boolean {
	return job.id.startsWith(DAILY_PREFIX);
}

export function dailyModelVerificationId(mappingId: string, now: Date): string {
	return (
		DAILY_PREFIX +
		now.toISOString().slice(0, 10) +
		":" +
		createHash("sha256").update(mappingId).digest("hex")
	);
}

/** Read uncached service state again at each side-effect boundary. */
export async function liveVerificationMapping(
	mappingId: string,
	now = new Date(),
	client: Transaction | typeof db = db,
) {
	const mapping = await client.query.modelProviderMapping.findFirst({
		where: { id: { eq: mappingId }, status: { eq: "active" } },
	});
	const target = mapping ? mappingTarget(mapping) : null;
	if (!mapping || (mapping.deactivatedAt && mapping.deactivatedAt <= now)) {
		return null;
	}
	const model = await client.query.model.findFirst({
		where: { id: { eq: mapping.modelId }, status: { eq: "active" } },
	});
	const provider = await client.query.provider.findFirst({
		where: { id: { eq: mapping.providerId }, status: { eq: "active" } },
	});
	if (
		!model ||
		!provider ||
		(!target?.decisions && !model.output.includes("text"))
	) {
		return null;
	}
	let draftModelId: string | null = null;
	const claim = await client.query.providerClaim.findFirst({
		where: { providerId: { eq: mapping.providerId }, status: { eq: "active" } },
	});
	if (mapping.source === "airside") {
		const listing = await client.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: mapping.providerId },
				modelName: { eq: mapping.modelId },
				externalId: { eq: mapping.externalId },
				status: { eq: "active" },
				pausedAt: { isNull: true },
			},
		});
		draftModelId = listing?.id ?? null;
		if (
			!listing ||
			!claim ||
			listing.providerCompanyId !== claim.providerCompanyId
		) {
			return null;
		}
	}
	return { mapping, claim, target: target!, draftModelId };
}

export function sameVerificationDeployment(
	left: ProviderModelVerificationTarget,
	right: ProviderModelVerificationTarget,
): boolean {
	return (
		left.providerId === right.providerId &&
		left.modelName === right.modelName &&
		left.externalId === right.externalId &&
		(left.region ?? null) === (right.region ?? null) &&
		(left.apiFormat ?? "openai-chat-completions") ===
			(right.apiFormat ?? "openai-chat-completions") &&
		Boolean(left.decisions) === Boolean(right.decisions)
	);
}

export async function currentCredentialSource(
	live: NonNullable<Awaited<ReturnType<typeof liveVerificationMapping>>>,
	client: Transaction | typeof db = db,
): Promise<Verification["credentialSource"] | null> {
	if (live.claim) {
		return live.claim.verificationKeyCiphertext ? "carrier" : null;
	}
	const keys = await client.query.providerKey.findMany({
		where: {
			provider: { eq: live.mapping.providerId },
			managed: { eq: true },
			status: { eq: "active" },
		},
		columns: { allowedModels: true, region: true },
	});
	if (
		narrowManagedKeysToRegion(
			keys.filter(
				(key) =>
					!key.allowedModels?.length ||
					key.allowedModels.includes(live.mapping.externalId),
			),
			live.mapping.providerId,
			live.target.region ?? undefined,
		).length > 0
	) {
		return "managed";
	}
	return modelVerificationEnvironmentToken(live.target) ? "environment" : null;
}

/** A deterministic primary key survives completion, restarts and replica races. */
export async function scheduleDailyModelVerifications(
	now = new Date(),
): Promise<number> {
	if (process.env.AIRSIDE_DAILY_VERIFICATION_ENABLED !== "true") {
		return 0;
	}
	let queued = 0;
	let cursor = "";
	while (true) {
		const mappings = await db.query.modelProviderMapping.findMany({
			where: { id: { gt: cursor }, status: { eq: "active" } },
			columns: { id: true },
			orderBy: { id: "asc" },
			limit: 100,
		});
		if (!mappings.length) {
			return queued;
		}
		for (const mapping of mappings) {
			queued += await db.transaction(async (tx) => {
				const [locked] = await tx
					.select({ id: tables.modelProviderMapping.id })
					.from(tables.modelProviderMapping)
					.where(
						and(
							eq(tables.modelProviderMapping.id, mapping.id),
							eq(tables.modelProviderMapping.status, "active"),
							or(
								isNull(tables.modelProviderMapping.deactivatedAt),
								gt(tables.modelProviderMapping.deactivatedAt, now),
							),
						),
					)
					.for("update", { skipLocked: true });
				if (!locked) {
					return 0;
				}
				const live = await liveVerificationMapping(mapping.id, now, tx);
				if (!live) {
					return 0;
				}
				const credentialSource = await currentCredentialSource(live, tx);
				if (!credentialSource) {
					return 0;
				}
				const [created] = await tx
					.insert(tables.providerModelVerification)
					.values({
						id: dailyModelVerificationId(mapping.id, now),
						modelProviderMappingId: mapping.id,
						draftModelId: live.draftModelId,
						providerCompanyId: live.claim?.providerCompanyId ?? null,
						initiatedBy: "admin",
						target: live.target,
						checks: createQueuedModelVerificationChecks(live.target),
						credentialSource,
					})
					.onConflictDoNothing()
					.returning({ id: tables.providerModelVerification.id });
				return created ? 1 : 0;
			});
		}
		cursor = mappings[mappings.length - 1].id;
	}
}

/** Scheduled runs never reuse the terminal history's erased ciphertext. */
export async function resolveDailyVerificationCredential(job: Verification) {
	if (!job.modelProviderMappingId) {
		throw new Error("Scheduled mapping is unavailable.");
	}
	const live = await liveVerificationMapping(job.modelProviderMappingId);
	if (!live || !sameVerificationDeclaration(live.target, job.target)) {
		throw new Error(
			"Scheduled listing is no longer eligible or its declaration changed.",
		);
	}
	const credentialSource = await currentCredentialSource(live);
	if (!credentialSource) {
		throw new Error("No current verification credential is available.");
	}
	if (live.claim && credentialSource === "carrier") {
		return {
			credentialSource,
			providerKey: decryptClaimVerificationKey(
				live.claim.verificationKeyCiphertext!,
				live.claim.id,
				live.claim.providerCompanyId,
			),
			baseUrl: live.claim.customBaseUrl ?? undefined,
		};
	}
	return { credentialSource, providerKey: undefined, baseUrl: undefined };
}
export function sameVerificationDeclaration(
	left: ProviderModelVerificationTarget,
	right: ProviderModelVerificationTarget,
): boolean {
	return isDeepStrictEqual(
		buildVerificationTarget(left),
		buildVerificationTarget(right),
	);
}
export function modelVerificationConcurrency(): number {
	const configured = Number(process.env.MODEL_VERIFICATION_CONCURRENCY);
	return Number.isInteger(configured) && configured >= 1 && configured <= 16
		? configured
		: 4;
}
