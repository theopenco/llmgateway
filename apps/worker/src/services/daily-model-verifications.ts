import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
	DAILY_MODEL_VERIFICATION_PREFIX,
	createQueuedModelVerificationChecks,
	mappingTarget,
	buildVerificationTarget,
	modelVerificationEnvironmentToken,
	narrowManagedKeysToRegion,
	providerVerificationCredentialFingerprint,
	environmentVerificationCredentialFingerprint,
} from "@llmgateway/actions";
import {
	and,
	db,
	eq,
	gt,
	isNull,
	or,
	tables,
	providerKeyAllowsModel,
} from "@llmgateway/db";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Verification = typeof tables.providerModelVerification.$inferSelect;
export function dailyModelVerificationId(mappingId: string, now: Date): string {
	return (
		DAILY_MODEL_VERIFICATION_PREFIX +
		now.toISOString().slice(0, 10) +
		":" +
		createHash("sha256").update(mappingId).digest("hex")
	);
}

/**
 * The daily re-check leaves out the context-window, output-budget and
 * prompt-cache probes: the first bills most of the declared window on every
 * run. Carrier preflight still runs them.
 */
export function dailyVerificationTarget(
	target: ProviderModelVerificationTarget,
): ProviderModelVerificationTarget {
	return {
		...target,
		contextSize: null,
		maxOutput: null,
		promptCaching: false,
	};
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
		if (await claimVerificationProviderKey(live.claim, live.target, client)) {
			return "carrier";
		}
		if (
			live.claim.kind !== "catalogue" ||
			live.claim.providerKeyId ||
			live.claim.pendingProviderKeyId
		) {
			return null;
		}
	}
	if (await managedVerificationProviderKey(live.target, client)) {
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
						target: dailyVerificationTarget({
							...(await currentVerificationTarget(live, tx)),
							gatewayExecutionVersion: undefined,
						}),
						checks: createQueuedModelVerificationChecks(
							dailyVerificationTarget(live.target),
						),
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
export async function resolveDailyVerificationCredential(
	job: Pick<Verification, "modelProviderMappingId" | "target">,
) {
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
		const key = await claimVerificationProviderKey(live.claim, live.target);
		if (!key) {
			throw new Error("No current verification credential is available.");
		}
		return {
			credentialSource,
			key,
			baseUrl: live.claim.customBaseUrl ?? key.baseUrl,
		};
	}
	return { credentialSource, key: undefined, baseUrl: undefined };
}
export function sameVerificationDeclaration(
	left: ProviderModelVerificationTarget,
	right: ProviderModelVerificationTarget,
): boolean {
	return isDeepStrictEqual(
		buildVerificationTarget(dailyVerificationTarget(left)),
		buildVerificationTarget(dailyVerificationTarget(right)),
	);
}
export function modelVerificationConcurrency(): number {
	const configured = Number(process.env.MODEL_VERIFICATION_CONCURRENCY);
	return Number.isInteger(configured) && configured >= 1 && configured <= 16
		? configured
		: 4;
}
export async function claimVerificationProviderKey(
	claim: typeof tables.providerClaim.$inferSelect,
	target: ProviderModelVerificationTarget,
	client: Transaction | typeof db = db,
	preferPending = false,
) {
	const keyId = preferPending
		? (claim.providerKeyId ?? claim.pendingProviderKeyId)
		: claim.providerKeyId;
	if (!keyId) {
		return null;
	}
	const key = await client.query.providerKey.findFirst({
		where: {
			id: { eq: keyId },
			provider: { eq: claim.providerId },
			managed: { eq: true },
			organizationId: { isNull: true },
		},
	});
	const pending = preferPending && keyId === claim.pendingProviderKeyId;
	if (
		!key ||
		(key.status !== "active" && !(pending && key.status === "inactive")) ||
		!providerKeyAllowsModel(key.allowedModels, target.modelName) ||
		!narrowManagedKeysToRegion(
			[key],
			target.providerId,
			target.region ?? undefined,
		).length
	) {
		return null;
	}
	return key;
}
export async function currentVerificationTarget(
	live: NonNullable<Awaited<ReturnType<typeof liveVerificationMapping>>>,
	client: Transaction | typeof db,
) {
	const carrierKeyed =
		live.claim &&
		(live.claim.providerKeyId ||
			live.claim.pendingProviderKeyId ||
			live.claim.kind !== "catalogue");
	const key =
		live.claim && carrierKeyed
			? await claimVerificationProviderKey(live.claim, live.target, client)
			: await managedVerificationProviderKey(live.target, client);
	if (key) {
		// Managed keys run on the static provider endpoint, so a catalogue
		// claim's dormant base URL must not enter their fingerprint.
		return {
			...live.target,
			providerKeyId: key.id,
			credentialFingerprint: providerVerificationCredentialFingerprint(
				key,
				carrierKeyed ? live.claim?.customBaseUrl : undefined,
			),
		};
	}
	const token = modelVerificationEnvironmentToken(live.target);
	return token
		? {
				...live.target,
				credentialFingerprint: environmentVerificationCredentialFingerprint(
					live.target,
					token,
				),
			}
		: live.target;
}
export async function managedVerificationProviderKey(
	target: ProviderModelVerificationTarget,
	client: Transaction | typeof db = db,
) {
	const keys = await client.query.providerKey.findMany({
		where: {
			...(target.providerKeyId ? { id: { eq: target.providerKeyId } } : {}),
			provider: { eq: target.providerId },
			managed: { eq: true },
			organizationId: { isNull: true },
			status: { eq: "active" },
		},
		orderBy: { sortOrder: "asc", createdAt: "asc", id: "asc" },
	});
	return (
		narrowManagedKeysToRegion(
			keys.filter((key) =>
				providerKeyAllowsModel(key.allowedModels, target.modelName),
			),
			target.providerId,
			target.region ?? undefined,
		)[0] ?? null
	);
}
export function sameVerificationCredential(
	proof: ProviderModelVerificationTarget,
	current: ProviderModelVerificationTarget,
): boolean {
	// Only completed gateway proofs can describe the current credential.
	return (
		proof.gatewayExecutionVersion === 1 &&
		(proof.providerKeyId ?? null) === (current.providerKeyId ?? null) &&
		(proof.credentialFingerprint ?? null) ===
			(current.credentialFingerprint ?? null)
	);
}
