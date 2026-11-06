import {
	disprovedCapabilities,
	managedCredentialOptions,
	readProviderKey,
	redactToken,
	runProviderModelVerification,
	modelVerificationEnvironmentToken,
	createAirsideGatewayFetch,
	providerVerificationCredentialFingerprint,
	airsideInferencePricing,
	environmentVerificationCredentialFingerprint,
} from "@llmgateway/actions";
import { and, asc, cdb, db, eq, lt, tables, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { REASONING_EFFORTS, TOOL_CHOICE_MODES } from "@llmgateway/models";

import {
	isDailyModelVerification,
	resolveDailyVerificationCredential,
	claimVerificationProviderKey,
	managedVerificationProviderKey,
} from "./daily-model-verifications.js";

import type { RunModelVerificationOptions } from "@llmgateway/actions";
import type {
	AirsideModelMetadataChanges,
	ProviderModelVerificationCheck,
} from "@llmgateway/db";
import type { ReasoningEffort, ToolChoiceMode } from "@llmgateway/models";

type VerificationRow = typeof tables.providerModelVerification.$inferSelect;
type VerificationRunner = (
	options: RunModelVerificationOptions,
) => ReturnType<typeof runProviderModelVerification>;

const STALE_RUNNING_MS = 20 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 3;
const STALE_ATTEMPT_FEEDBACK = "Verification timed out.";

interface ResolvedCredential {
	providerKey: string;
	providerKeyId?: string;
	credentialFingerprint?: string;
	baseUrl?: string;
	providerKeyOptions?: RunModelVerificationOptions["providerKeyOptions"];
	skipEnvVars?: boolean;
}

async function managedCredential(
	job: CredentialJob,
): Promise<ResolvedCredential> {
	const key = await managedVerificationProviderKey(job.target, db);
	if (!key) {
		throw new Error("No active managed credential can verify this mapping.");
	}
	return resolvedProviderKey(key);
}

function environmentCredential(job: CredentialJob): string {
	const token = modelVerificationEnvironmentToken(job.target);
	if (!token) {
		throw new Error(
			"No environment credential is configured for this provider.",
		);
	}
	return token;
}

/**
 * Runs that belong to no carrier target catalogue mappings we already serve,
 * so they resolve the platform's own credentials without a provider claim.
 */
async function resolvePlatformCredential(
	job: CredentialJob,
): Promise<ResolvedCredential> {
	if (job.credentialSource === "managed") {
		return await managedCredential(job);
	}
	if (job.credentialSource !== "environment") {
		throw new Error(
			"A platform-managed credential is required for catalogue verification.",
		);
	}
	const token = environmentCredential(job);
	return {
		providerKey: token,
		credentialFingerprint: environmentVerificationCredentialFingerprint(
			job.target,
			token,
		),
	};
}

export async function resolveCredential(
	job: CredentialJob,
	preferPending = true,
): Promise<ResolvedCredential> {
	if (isDailyModelVerification(job)) {
		const current = await resolveDailyVerificationCredential(job);
		if (current.key) {
			return resolvedProviderKey(current.key, current.baseUrl);
		}
		return await resolvePlatformCredential({
			...job,
			providerCompanyId: null,
			credentialSource: current.credentialSource,
		});
	}
	if (!job.providerCompanyId) {
		return await resolvePlatformCredential(job);
	}
	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: job.providerCompanyId },
			providerId: { eq: job.target.providerId },
			status: { eq: "active" },
		},
	});
	if (!claim) {
		throw new Error("The provider claim is no longer active.");
	}
	if (
		claim.kind === "catalogue" &&
		!claim.providerKeyId &&
		!claim.pendingProviderKeyId &&
		(job.credentialSource === "managed" ||
			job.credentialSource === "environment")
	) {
		return await resolvePlatformCredential(job);
	}
	const key = await claimVerificationProviderKey(
		claim,
		job.target,
		db,
		preferPending,
	);
	if (!key) {
		throw new Error("No linked provider credential can verify this listing.");
	}
	return resolvedProviderKey(key, claim.customBaseUrl);
}

export async function claimNextModelVerification(): Promise<VerificationRow | null> {
	return await db.transaction(async (tx) => {
		const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
		const staleJobs = await tx
			.select({
				id: tables.providerModelVerification.id,
				attempts: tables.providerModelVerification.attempts,
				checks: tables.providerModelVerification.checks,
			})
			.from(tables.providerModelVerification)
			.where(
				and(
					eq(tables.providerModelVerification.status, "running"),
					lt(tables.providerModelVerification.updatedAt, staleBefore),
				),
			)
			.for("update", { skipLocked: true });
		for (const staleJob of staleJobs) {
			const exhausted = staleJob.attempts >= MAX_VERIFICATION_ATTEMPTS;
			await tx
				.update(tables.providerModelVerification)
				.set(
					exhausted
						? {
								status: "failed",
								checks: terminalChecks(staleJob.checks, STALE_ATTEMPT_FEEDBACK),
								summary: STALE_ATTEMPT_FEEDBACK,
								completedAt: new Date(),
								credentialCiphertext: null,
							}
						: { status: "queued", startedAt: null },
				)
				.where(
					and(
						eq(tables.providerModelVerification.id, staleJob.id),
						eq(tables.providerModelVerification.status, "running"),
						eq(tables.providerModelVerification.attempts, staleJob.attempts),
						lt(tables.providerModelVerification.updatedAt, staleBefore),
					),
				);
		}
		const candidates = await tx
			.select()
			.from(tables.providerModelVerification)
			.where(
				and(
					eq(tables.providerModelVerification.status, "queued"),
					sql`(${tables.providerModelVerification.id} NOT LIKE 'daily-verification:%' OR NOT EXISTS (SELECT 1 FROM ${tables.providerModelVerification} running WHERE running.status = 'running' AND running.target->>'providerId' = ${tables.providerModelVerification.target}->>'providerId'))`,
				),
			)
			.orderBy(
				sql`CASE WHEN ${tables.providerModelVerification.id} LIKE 'daily-verification:%' THEN 1 ELSE 0 END`,
				sql`row_number() OVER (PARTITION BY ${tables.providerModelVerification.target}->>'providerId' ORDER BY ${tables.providerModelVerification.createdAt}, ${tables.providerModelVerification.id})`,
				asc(tables.providerModelVerification.createdAt),
			)
			.limit(100);
		for (const candidate of candidates) {
			const [job] = await tx
				.select()
				.from(tables.providerModelVerification)
				.where(
					and(
						eq(tables.providerModelVerification.id, candidate.id),
						eq(tables.providerModelVerification.status, "queued"),
					),
				)
				.for("update", { skipLocked: true });
			if (!job) {
				continue;
			}
			if (isDailyModelVerification(job)) {
				const [provider] = await tx
					.select({ id: tables.provider.id })
					.from(tables.provider)
					.where(eq(tables.provider.id, job.target.providerId))
					.for("update", { skipLocked: true });
				if (!provider) {
					continue;
				}
				const [running] = await tx
					.select({ id: tables.providerModelVerification.id })
					.from(tables.providerModelVerification)
					.where(
						and(
							eq(tables.providerModelVerification.status, "running"),
							sql`${tables.providerModelVerification.target}->>'providerId' = ${job.target.providerId}`,
						),
					)
					.limit(1);
				if (running) {
					continue;
				}
			}
			const [claimed] = await tx
				.update(tables.providerModelVerification)
				.set({
					status: "running",
					startedAt: new Date(),
					completedAt: null,
					summary: null,
					attempts: job.attempts + 1,
				})
				.where(
					and(
						eq(tables.providerModelVerification.id, job.id),
						eq(tables.providerModelVerification.status, "queued"),
						eq(tables.providerModelVerification.attempts, job.attempts),
					),
				)
				.returning();
			if (claimed) {
				return claimed;
			}
		}
		return null;
	});
}

class StaleModelVerificationAttemptError extends Error {}

function replaceCheck(
	checks: ProviderModelVerificationCheck[],
	next: ProviderModelVerificationCheck,
): ProviderModelVerificationCheck[] {
	return checks.map((check) => (check.id === next.id ? next : check));
}

function terminalChecks(
	checks: ProviderModelVerificationCheck[],
	feedback: string,
): ProviderModelVerificationCheck[] {
	let failed = false;
	return checks.map((check) => {
		if (!failed && (check.status === "queued" || check.status === "running")) {
			failed = true;
			return { ...check, status: "failed", feedback };
		}
		return check.status === "queued"
			? {
					...check,
					status: "skipped",
					feedback: "Skipped after verification failed.",
				}
			: check;
	});
}

function sameList(
	a: readonly string[] | null | undefined,
	b: readonly string[] | null | undefined,
): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * A `tool_choice` mode the tool check probed and the upstream did not honour,
 * where a weaker mode then worked. Tool calling itself is proven, so the
 * listing keeps `tools` and instead records the modes that do work — the
 * gateway downgrades a request asking for a dropped mode rather than
 * forwarding one the deployment answers with unusable output.
 */
async function narrowToolChoiceSupport(
	job: VerificationRow,
	unsupported: ToolChoiceMode[] | undefined,
): Promise<void> {
	if (!job.draftModelId || !unsupported?.length) {
		return;
	}
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: job.draftModelId } },
	});
	if (!model || model.status === "delisted") {
		return;
	}
	const declared = model.supportedToolChoices ?? TOOL_CHOICE_MODES;
	const supportedToolChoices = declared.filter(
		(mode) => !unsupported.includes(mode),
	);
	if (supportedToolChoices.length === declared.length) {
		return;
	}
	// cdb: the gateway caches listing resolution off both tables.
	await cdb.transaction(async (tx) => {
		await tx
			.update(tables.providerDraftModel)
			.set({ supportedToolChoices })
			.where(eq(tables.providerDraftModel.id, model.id));
		if (model.status !== "active") {
			return;
		}
		await tx
			.update(tables.modelProviderMapping)
			.set({ supportedToolChoices })
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, model.modelName),
					eq(tables.modelProviderMapping.providerId, model.providerId),
					eq(tables.modelProviderMapping.source, "airside"),
				),
			);
	});
	logger.info("Narrowed an Airside listing's tool_choice support", {
		verificationId: job.id,
		draftModelId: model.id,
		providerId: model.providerId,
		unsupported,
		supportedToolChoices,
	});
}

/**
 * An effort tier the reasoning check probed and the upstream refused, where
 * another tier then worked. Reasoning itself is proven, so the listing keeps it
 * and drops only the refused tiers. The gateway forwards an effort as-is, so
 * this is what makes the tier list it publishes match what the deployment takes.
 *
 * The tiers come off whichever list the run was actually targeting: the row's,
 * or a pending filing's when the carrier is proposing a different set. Removing
 * them from the row alone would leave the filing able to reinstate a tier the
 * endpoint just refused.
 */
async function narrowReasoningEfforts(
	job: VerificationRow,
	unsupported: ReasoningEffort[] | undefined,
): Promise<void> {
	if (!job.draftModelId || !unsupported?.length) {
		return;
	}
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: job.draftModelId } },
	});
	if (!model || model.status === "delisted" || !model.reasoning) {
		return;
	}
	const filing = await db.query.providerPriceFiling.findFirst({
		where: {
			draftModelId: { eq: model.id },
			status: { eq: "pending" },
			kind: { eq: "metadata" },
		},
	});
	const narrow = (
		declared: readonly ReasoningEffort[] | null,
	): ReasoningEffort[] | undefined => {
		const from = declared ?? REASONING_EFFORTS;
		const kept = from.filter((effort) => !unsupported.includes(effort));
		// Nothing left to declare reads as "no restriction", the opposite of what
		// the probes found — but every tier refused also fails the run, so the
		// demotion owns that outcome.
		return kept.length === from.length || kept.length === 0 ? undefined : kept;
	};
	const filedEfforts = filing?.metadata?.reasoningEfforts as
		ReasoningEffort[] | null | undefined;
	const rowEfforts = model.reasoningEfforts as ReasoningEffort[] | null;
	// The run targeted the filed tiers when there are any, so they are the list
	// the refusals speak about; the row's own list only moves when it is what
	// was probed.
	const filed = filedEfforts === undefined ? undefined : narrow(filedEfforts);
	const reasoningEfforts =
		filedEfforts === undefined || sameList(filedEfforts, rowEfforts)
			? narrow(rowEfforts)
			: undefined;
	if (!reasoningEfforts && !filed) {
		return;
	}
	// cdb: the gateway caches listing resolution off both tables.
	await cdb.transaction(async (tx) => {
		if (reasoningEfforts) {
			await tx
				.update(tables.providerDraftModel)
				.set({ reasoningEfforts })
				.where(eq(tables.providerDraftModel.id, model.id));
			if (model.status === "active") {
				await tx
					.update(tables.modelProviderMapping)
					.set({ reasoningEfforts })
					.where(
						and(
							eq(tables.modelProviderMapping.modelId, model.modelName),
							eq(tables.modelProviderMapping.providerId, model.providerId),
							eq(tables.modelProviderMapping.source, "airside"),
						),
					);
			}
		}
		if (!filing || !filed) {
			return;
		}
		await tx
			.update(tables.providerPriceFiling)
			.set({
				metadata: {
					...filing.metadata,
					reasoningEfforts: filed,
				} as AirsideModelMetadataChanges,
			})
			.where(
				and(
					eq(tables.providerPriceFiling.id, filing.id),
					eq(tables.providerPriceFiling.status, "pending"),
				),
			);
	});
	logger.info("Narrowed an Airside listing's reasoning effort tiers", {
		verificationId: job.id,
		draftModelId: model.id,
		providerId: model.providerId,
		unsupported,
		reasoningEfforts,
		filed,
	});
}

export async function processNextModelVerification(
	runner: VerificationRunner = runProviderModelVerification,
): Promise<boolean> {
	const job = await claimNextModelVerification();
	if (!job) {
		return false;
	}
	let token = "";
	let infrastructureError: Error | undefined;
	let gatewayExecuted = false;
	let checks = job.checks;
	try {
		let credential: ResolvedCredential;
		let pricing: ReturnType<typeof airsideInferencePricing>;
		try {
			credential = await resolveCredential(job);
			pricing = await verificationPricing(job);
			if (
				(job.target.providerKeyId &&
					job.target.providerKeyId !== credential.providerKeyId) ||
				(job.target.credentialFingerprint &&
					job.target.credentialFingerprint !== credential.credentialFingerprint)
			) {
				throw new Error("Verification credential changed.");
			}
		} catch {
			infrastructureError = new Error(
				"Verification configuration is unavailable or changed. Re-run verification.",
			);
			throw infrastructureError;
		}
		token = credential.providerKey;
		const gatewayFetch = createAirsideGatewayFetch({
			runId: job.id,
			providerKeyId: credential.providerKeyId,
			target: job.target,
			pricing,
			onInfrastructureError: (error) => {
				infrastructureError = error;
			},
		});
		const result = await runner({
			target: job.target,
			token,
			baseUrl: credential.baseUrl,
			providerKeyOptions: credential.providerKeyOptions,
			skipEnvVars: credential.skipEnvVars,
			fetchImplementation: async (input, init) => {
				const response = await gatewayFetch(input, init);
				gatewayExecuted = true;
				return response;
			},
			onCheck: async (check) => {
				checks = replaceCheck(checks, check);
				const updated = await db
					.update(tables.providerModelVerification)
					.set({ checks })
					.where(
						and(
							eq(tables.providerModelVerification.id, job.id),
							eq(tables.providerModelVerification.status, "running"),
							eq(tables.providerModelVerification.attempts, job.attempts),
						),
					)
					.returning({ id: tables.providerModelVerification.id });
				if (updated.length === 0) {
					throw new StaleModelVerificationAttemptError();
				}
			},
		});
		if (!infrastructureError) {
			try {
				const current = await resolveCredential(job);
				if (
					current.providerKeyId !== credential.providerKeyId ||
					current.credentialFingerprint !== credential.credentialFingerprint ||
					current.providerKey !== credential.providerKey ||
					current.baseUrl !== credential.baseUrl
				) {
					throw new Error("Verification credential changed.");
				}
			} catch {
				infrastructureError = new Error(
					"Verification configuration changed during execution. Re-run verification.",
				);
			}
		}
		if (infrastructureError) {
			throw infrastructureError;
		}
		const completed = await db
			.update(tables.providerModelVerification)
			.set({
				status: result.passed ? "passed" : "failed",
				target: {
					...job.target,
					providerKeyId: credential.providerKeyId,
					credentialFingerprint: credential.credentialFingerprint,
					gatewayExecutionVersion: gatewayExecuted ? 1 : undefined,
				},
				checks: result.checks,
				summary: result.summary,
				completedAt: new Date(),
				credentialCiphertext: null,
			})
			.where(
				and(
					eq(tables.providerModelVerification.id, job.id),
					eq(tables.providerModelVerification.status, "running"),
					eq(tables.providerModelVerification.attempts, job.attempts),
				),
			)
			.returning({ id: tables.providerModelVerification.id });
		if (completed.length === 0) {
			return true;
		}
		if (!result.passed) {
			// A failed check is the endpoint refusing a claim the listing
			// advertises, but one refused request is not enough evidence to take a
			// capability away: a transient upstream fault, a rate limit and a
			// fixture the deployment happens to dislike all look the same from
			// here. The failure is recorded and reported; the listing is left
			// exactly as the carrier declared it, and acting on it is a human
			// decision for now. `demotedCapabilities` and the automatic demotion it
			// described are deliberately left unwritten rather than removed —
			// demotion is expected back once a failure can be corroborated.
			logger.info("An Airside verification disproved declared capabilities", {
				verificationId: job.id,
				draftModelId: job.draftModelId,
				providerId: job.target.providerId,
				capabilities: disprovedCapabilities(result.checks),
			});
		}
		if (!isDailyModelVerification(job)) {
			await narrowToolChoiceSupport(job, result.unsupportedToolChoices);
			await narrowReasoningEfforts(job, result.unsupportedReasoningEfforts);
		}
	} catch (error) {
		if (error instanceof StaleModelVerificationAttemptError) {
			return true;
		}
		const feedback = redactToken(
			(error instanceof Error ? error.message : "Verification failed.").slice(
				0,
				500,
			),
			token,
		);
		checks =
			infrastructureError || (isDailyModelVerification(job) && !token)
				? checks.map((check) => ({
						...check,
						status: "skipped" as const,
						feedback: infrastructureError
							? "Operator gateway verification is currently unavailable."
							: "Scheduled verification is currently unavailable.",
					}))
				: terminalChecks(checks, feedback);
		const completed = await db
			.update(tables.providerModelVerification)
			.set({
				status: "failed",
				target: { ...job.target, gatewayExecutionVersion: undefined },
				checks,
				summary: feedback,
				completedAt: new Date(),
				credentialCiphertext: null,
			})
			.where(
				and(
					eq(tables.providerModelVerification.id, job.id),
					eq(tables.providerModelVerification.status, "running"),
					eq(tables.providerModelVerification.attempts, job.attempts),
				),
			)
			.returning({ id: tables.providerModelVerification.id });
		if (completed.length === 0) {
			return true;
		}
		logger.warn("Airside model verification failed", {
			verificationId: job.id,
			providerId: job.target.providerId,
			error: feedback,
		});
	}
	return true;
}
function resolvedProviderKey(
	key: typeof tables.providerKey.$inferSelect,
	baseUrl?: string | null,
): ResolvedCredential {
	const effectiveBaseUrl = baseUrl ?? key.baseUrl;
	return {
		providerKey: readProviderKey(key),
		providerKeyId: key.id,
		credentialFingerprint: providerVerificationCredentialFingerprint(
			key,
			effectiveBaseUrl,
		),
		baseUrl: effectiveBaseUrl ?? undefined,
		providerKeyOptions: managedCredentialOptions(key),
		skipEnvVars: true,
	};
}
async function verificationPricing(job: VerificationRow) {
	if (!job.modelProviderMappingId && !job.draftModelId) {
		if (!job.target.pricing) {
			throw new Error(
				"Verification inference pricing snapshot is unavailable.",
			);
		}
		return airsideInferencePricing(job.target);
	}
	const mapping = await db.query.modelProviderMapping.findFirst({
		where: {
			...(job.modelProviderMappingId
				? { id: { eq: job.modelProviderMappingId } }
				: { source: { eq: "airside" as const } }),
			providerId: { eq: job.target.providerId },
			modelId: { eq: job.target.modelName },
			externalId: { eq: job.target.externalId },
			region: job.target.region ? { eq: job.target.region } : { isNull: true },
		},
	});
	if (job.modelProviderMappingId && !mapping) {
		throw new Error("Verification inference mapping changed.");
	}
	const filing =
		job.draftModelId && !mapping && !isDailyModelVerification(job)
			? await db.query.providerPriceFiling.findFirst({
					where: {
						draftModelId: { eq: job.draftModelId },
						status: { ne: "rejected" },
					},
					orderBy: { createdAt: "desc", id: "desc" },
				})
			: undefined;
	if (!mapping && !filing && !job.target.pricing) {
		throw new Error("Verification inference pricing snapshot is unavailable.");
	}
	return airsideInferencePricing(job.target, mapping, filing);
}
type CredentialJob = Pick<
	VerificationRow,
	| "id"
	| "target"
	| "providerCompanyId"
	| "credentialSource"
	| "modelProviderMappingId"
>;
