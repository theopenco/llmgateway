import {
	decryptModelVerificationCredential,
	disprovedCapabilities,
	managedCredentialOptions,
	readProviderKey,
	redactToken,
	runProviderModelVerification,
} from "@llmgateway/actions";
import { and, asc, cdb, db, eq, lt, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getProviderEnvVar, TOOL_CHOICE_MODES } from "@llmgateway/models";

import type { RunModelVerificationOptions } from "@llmgateway/actions";
import type { ProviderModelVerificationCheck } from "@llmgateway/db";
import type { ToolChoiceMode } from "@llmgateway/models";

type VerificationRow = typeof tables.providerModelVerification.$inferSelect;
type VerificationRunner = (
	options: RunModelVerificationOptions,
) => ReturnType<typeof runProviderModelVerification>;

const STALE_RUNNING_MS = 20 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 3;
const STALE_ATTEMPT_FEEDBACK = "Verification timed out.";

interface ResolvedCredential {
	providerKey: string;
	baseUrl?: string;
	providerKeyOptions?: RunModelVerificationOptions["providerKeyOptions"];
	skipEnvVars?: boolean;
}

function firstEnvironmentCredential(value: string): string {
	const trimmed = value.trim();
	return trimmed.startsWith("{") ? value : (value.split(",")[0]?.trim() ?? "");
}

async function managedCredential(
	job: VerificationRow,
	baseUrlOverride?: string,
): Promise<ResolvedCredential> {
	const keys = await db.query.providerKey.findMany({
		where: {
			provider: { eq: job.target.providerId },
			managed: { eq: true },
			status: { eq: "active" },
		},
		orderBy: { sortOrder: "asc", createdAt: "asc" },
	});
	const key = keys.find(
		(candidate) =>
			!candidate.allowedModels?.length ||
			candidate.allowedModels.includes(job.target.externalId),
	);
	if (!key) {
		throw new Error("No active managed credential can verify this mapping.");
	}
	return {
		providerKey: readProviderKey(key),
		baseUrl: baseUrlOverride ?? key.baseUrl ?? undefined,
		providerKeyOptions: managedCredentialOptions(key),
		skipEnvVars: true,
	};
}

function environmentCredential(job: VerificationRow): string {
	const envName = getProviderEnvVar(job.target.providerId);
	const token = envName
		? firstEnvironmentCredential(process.env[envName] ?? "")
		: "";
	if (!token) {
		throw new Error(
			"No environment credential is configured for this provider. Re-run the verification with a provider API key.",
		);
	}
	return token;
}

/**
 * Runs that belong to no carrier target catalogue mappings we already serve,
 * so they resolve the platform's own credentials without a provider claim.
 */
async function resolvePlatformCredential(
	job: VerificationRow,
): Promise<ResolvedCredential> {
	if (job.credentialSource === "supplied") {
		if (!job.credentialCiphertext) {
			throw new Error("The supplied verification credential is unavailable.");
		}
		return {
			providerKey: decryptModelVerificationCredential(
				job.credentialCiphertext,
				job.id,
				job.providerCompanyId,
			),
		};
	}
	if (job.credentialSource === "managed") {
		return await managedCredential(job);
	}
	return { providerKey: environmentCredential(job) };
}

async function resolveCredential(
	job: VerificationRow,
): Promise<ResolvedCredential> {
	// A run with no carrier (an admin run against a catalogue mapping) has no
	// claim to resolve; admin runs against a carrier's listing keep the
	// claim-scoped path so a custom carrier's base URL still applies.
	if (!job.providerCompanyId) {
		return await resolvePlatformCredential(job);
	}
	const companyId = job.providerCompanyId;
	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: companyId },
			providerId: { eq: job.target.providerId },
			status: { eq: "active" },
		},
	});
	if (!claim) {
		throw new Error("The provider claim is no longer active.");
	}
	if (job.credentialSource === "supplied") {
		if (!job.credentialCiphertext) {
			throw new Error("The supplied verification credential is unavailable.");
		}
		return {
			providerKey: decryptModelVerificationCredential(
				job.credentialCiphertext,
				job.id,
				job.providerCompanyId,
			),
			baseUrl: claim.customBaseUrl ?? undefined,
			skipEnvVars: claim.kind === "custom",
		};
	}
	if (job.credentialSource === "managed") {
		return await managedCredential(job, claim.customBaseUrl ?? undefined);
	}
	return {
		providerKey: environmentCredential(job),
		baseUrl: claim.customBaseUrl ?? undefined,
	};
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
		const [job] = await tx
			.select()
			.from(tables.providerModelVerification)
			.where(eq(tables.providerModelVerification.status, "queued"))
			.orderBy(asc(tables.providerModelVerification.createdAt))
			.limit(1)
			.for("update", { skipLocked: true });
		if (!job) {
			return null;
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
		return claimed ?? null;
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

type CapabilityDemotion = Partial<
	Pick<
		typeof tables.providerDraftModel.$inferInsert,
		| "streaming"
		| "vision"
		| "audio"
		| "tools"
		| "jsonOutput"
		| "jsonOutputSchema"
		| "reasoning"
		| "reasoningMaxTokens"
		| "reasoningEfforts"
		| "webSearch"
	>
>;

/**
 * A failed check is the endpoint disproving a claim the listing advertises,
 * so the listing drops to what it actually does rather than keeping a flag
 * routing would send matching traffic to. Only the listing's own capabilities
 * move: a run against a static catalogue mapping never rewrites the
 * catalogue. Active listings serve off their materialized mapping row, so the
 * demotion has to reach that too.
 */
async function demoteDisprovedCapabilities(
	job: VerificationRow,
	checks: ProviderModelVerificationCheck[],
): Promise<void> {
	if (!job.draftModelId) {
		return;
	}
	const disproved = disprovedCapabilities(checks);
	if (disproved.length === 0) {
		return;
	}
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: job.draftModelId } },
	});
	if (!model || model.status === "delisted") {
		return;
	}
	const updates: CapabilityDemotion = {};
	for (const capability of disproved) {
		if (model[capability]) {
			updates[capability] = false;
		}
	}
	// Effort tiers and a thinking budget mean nothing once reasoning itself
	// fails, so they go with it rather than outliving their own capability.
	if (updates.reasoning === false) {
		if (model.reasoningMaxTokens) {
			updates.reasoningMaxTokens = false;
		}
		if (model.reasoningEfforts?.length) {
			updates.reasoningEfforts = null;
		}
	}
	if (Object.keys(updates).length === 0) {
		return;
	}
	// cdb: the gateway caches listing resolution off both tables.
	await cdb.transaction(async (tx) => {
		await tx
			.update(tables.providerDraftModel)
			.set(updates)
			.where(eq(tables.providerDraftModel.id, model.id));
		if (model.status !== "active") {
			return;
		}
		await tx
			.update(tables.modelProviderMapping)
			.set(updates)
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, model.modelName),
					eq(tables.modelProviderMapping.providerId, model.providerId),
					eq(tables.modelProviderMapping.source, "airside"),
				),
			);
	});
	logger.info("Demoted an Airside listing after a failed verification", {
		verificationId: job.id,
		draftModelId: model.id,
		providerId: model.providerId,
		capabilities: Object.keys(updates),
	});
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

export async function processNextModelVerification(
	runner: VerificationRunner = runProviderModelVerification,
): Promise<boolean> {
	const job = await claimNextModelVerification();
	if (!job) {
		return false;
	}
	let token = "";
	let checks = job.checks;
	try {
		const credential = await resolveCredential(job);
		token = credential.providerKey;
		const result = await runner({
			target: job.target,
			token,
			baseUrl: credential.baseUrl,
			providerKeyOptions: credential.providerKeyOptions,
			skipEnvVars: credential.skipEnvVars,
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
		const completed = await db
			.update(tables.providerModelVerification)
			.set({
				status: result.passed ? "passed" : "failed",
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
			await demoteDisprovedCapabilities(job, result.checks);
		}
		await narrowToolChoiceSupport(job, result.unsupportedToolChoices);
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
		checks = terminalChecks(checks, feedback);
		const completed = await db
			.update(tables.providerModelVerification)
			.set({
				status: "failed",
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
