import {
	decryptModelVerificationCredential,
	managedCredentialOptions,
	readProviderKey,
	redactToken,
	runProviderModelVerification,
} from "@llmgateway/actions";
import { and, asc, db, eq, lt, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getProviderEnvVar } from "@llmgateway/models";

import type { RunModelVerificationOptions } from "@llmgateway/actions";
import type { ProviderModelVerificationCheck } from "@llmgateway/db";

type VerificationRow = typeof tables.providerModelVerification.$inferSelect;
type VerificationRunner = (
	options: RunModelVerificationOptions,
) => ReturnType<typeof runProviderModelVerification>;

const STALE_RUNNING_MS = 20 * 60 * 1000;

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

async function resolveCredential(
	job: VerificationRow,
): Promise<ResolvedCredential> {
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
				candidate.allowedModels.includes(job.target.modelName),
		);
		if (!key) {
			throw new Error("No active managed credential can verify this mapping.");
		}
		return {
			providerKey: readProviderKey(key),
			baseUrl: claim.customBaseUrl ?? key.baseUrl ?? undefined,
			providerKeyOptions: managedCredentialOptions(key),
			skipEnvVars: true,
		};
	}
	const envName = getProviderEnvVar(job.target.providerId);
	const token = envName
		? firstEnvironmentCredential(process.env[envName] ?? "")
		: "";
	if (!token) {
		throw new Error(
			"No environment credential is configured for this provider.",
		);
	}
	return { providerKey: token, baseUrl: claim.customBaseUrl ?? undefined };
}

export async function claimNextModelVerification(): Promise<VerificationRow | null> {
	return await db.transaction(async (tx) => {
		const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
		await tx
			.update(tables.providerModelVerification)
			.set({ status: "queued", startedAt: null })
			.where(
				and(
					eq(tables.providerModelVerification.status, "running"),
					lt(tables.providerModelVerification.updatedAt, staleBefore),
				),
			);
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
			.where(eq(tables.providerModelVerification.id, job.id))
			.returning();
		return claimed;
	});
}

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
				await db
					.update(tables.providerModelVerification)
					.set({ checks })
					.where(eq(tables.providerModelVerification.id, job.id));
			},
		});
		await db
			.update(tables.providerModelVerification)
			.set({
				status: result.passed ? "passed" : "failed",
				checks: result.checks,
				summary: result.summary,
				completedAt: new Date(),
				credentialCiphertext: null,
			})
			.where(eq(tables.providerModelVerification.id, job.id));
	} catch (error) {
		const feedback = redactToken(
			(error instanceof Error ? error.message : "Verification failed.").slice(
				0,
				500,
			),
			token,
		);
		checks = terminalChecks(checks, feedback);
		await db
			.update(tables.providerModelVerification)
			.set({
				status: "failed",
				checks,
				summary: feedback,
				completedAt: new Date(),
				credentialCiphertext: null,
			})
			.where(eq(tables.providerModelVerification.id, job.id));
		logger.warn("Airside model verification failed", {
			verificationId: job.id,
			providerId: job.target.providerId,
			error: feedback,
		});
	}
	return true;
}
