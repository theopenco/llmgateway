import { createQueuedModelVerificationChecks } from "@llmgateway/actions";
import {
	and,
	asc,
	db,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	or,
	sql,
	tables,
	isNotNull,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	liveVerificationMapping,
	sameVerificationDeployment,
	currentCredentialSource,
	sameVerificationDeclaration,
} from "./daily-model-verifications.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

type Verification = typeof tables.providerModelVerification.$inferSelect;
const RETRY_MS = 5 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EPOCH = new Date(0);
const progress = tables.aggregationProgress;
const verifications = tables.providerModelVerification;

const CHECK_FIELDS: Record<string, (keyof ProviderModelVerificationTarget)[]> =
	{
		tools: ["supportedToolChoices"],
		reasoning: ["reasoningEfforts"],
		reasoning_budget: ["reasoningEfforts"],
		context_size: ["contextSize"],
		max_output: ["maxOutput"],
		web_search: ["webSearchFormat"],
	};

/** Compare the last actual observation, not any historical pass: recovery re-arms alerts. */
export function regressedVerificationChecks(
	current: Verification,
	history: Verification[],
): string[] {
	const declared = new Set(
		createQueuedModelVerificationChecks(current.target).map(
			(check) => check.id,
		),
	);
	return current.checks
		.filter((check) => {
			if (!declared.has(check.id)) {
				return false;
			}
			const failures = [
				...(check.status === "failed" ? [""] : []),
				...(check.probes ?? [])
					.filter((probe) => probe.status === "failed")
					.map((probe) => probe.label),
			];
			return failures.some((label) => {
				for (const previous of history) {
					if (!sameVerificationDeployment(current.target, previous.target)) {
						continue;
					}
					if (
						(CHECK_FIELDS[check.id] ?? []).some(
							(key) =>
								JSON.stringify(current.target[key] ?? null) !==
								JSON.stringify(previous.target[key] ?? null),
						)
					) {
						continue;
					}
					const oldCheck = previous.checks.find(
						(candidate) => candidate.id === check.id,
					);
					const status = label
						? oldCheck?.probes?.find((probe) => probe.label === label)?.status
						: oldCheck?.status;
					if (status === "passed" || status === "failed") {
						return status === "passed";
					}
				}
				return false;
			});
		})
		.map((check) => check.id);
}

function publicIdentifier(value: string): string {
	return value.replace(/[^a-zA-Z0-9._/: -]/g, "_").slice(0, 180);
}

export function modelVerificationRegressionPayload(
	job: Verification,
	checks: string[],
) {
	return {
		allowed_mentions: { parse: [] },
		embeds: [
			{
				title: "Model verification regression",
				description:
					publicIdentifier(job.target.providerId) +
					"/" +
					publicIdentifier(job.target.modelName),
				fields: [
					{
						name: "Region",
						value:
							publicIdentifier(job.target.region ?? "default") || "default",
					},
					{
						name: "Previously passing checks",
						value: checks.join(", ").slice(0, 1000),
					},
					{ name: "Verification", value: job.id },
				],
				timestamp: job.completedAt?.toISOString(),
			},
		],
	};
}

/** Durable retry/outbox state uses the existing job progress table, never the result row. */
export async function deliverModelVerificationRegressions(
	now = new Date(),
	fetchImplementation: typeof fetch = fetch,
): Promise<number> {
	const webhook = process.env.AIRSIDE_VERIFICATION_DISCORD_WEBHOOK_URL;
	if (!webhook) {
		return 0;
	}
	const pending = await db
		.select({ job: verifications })
		.from(verifications)
		.leftJoin(
			progress,
			and(
				eq(
					progress.job,
					sql`'daily-verification-alert:' || ${verifications.id}`,
				),
				eq(progress.bucketTimestamp, EPOCH),
			),
		)
		.where(
			and(
				inArray(verifications.status, ["passed", "failed"]),
				or(
					gte(verifications.createdAt, new Date(now.getTime() - RETENTION_MS)),
					isNotNull(progress.refreshedAt),
				),
				sql`${verifications.id} LIKE 'daily-verification:%'`,
				isNull(progress.finalizedAt),
				or(isNull(progress.refreshedAt), lt(progress.refreshedAt, now)),
			),
		)
		.orderBy(asc(verifications.createdAt))
		.limit(100);
	let delivered = 0;
	for (const { job } of pending) {
		delivered += await db.transaction(async (tx) => {
			const key = "daily-verification-alert:" + job.id;
			await tx
				.insert(progress)
				.values({ job: key, bucketTimestamp: EPOCH })
				.onConflictDoNothing();
			const [state] = await tx
				.select()
				.from(progress)
				.where(and(eq(progress.job, key), eq(progress.bucketTimestamp, EPOCH)))
				.for("update", { skipLocked: true });
			if (
				!state ||
				state.finalizedAt ||
				(state.refreshedAt && state.refreshedAt > now)
			) {
				return 0;
			}
			const finish = async () => {
				await tx
					.update(progress)
					.set({ finalizedAt: now, refreshedAt: now })
					.where(
						and(eq(progress.job, key), eq(progress.bucketTimestamp, EPOCH)),
					);
			};
			const live = job.modelProviderMappingId
				? await liveVerificationMapping(job.modelProviderMappingId, now, tx)
				: null;
			if (
				!live ||
				!sameVerificationDeclaration(job.target, live.target) ||
				!(await currentCredentialSource(live, tx))
			) {
				await finish();
				return 0;
			}
			const listing = await tx.query.providerDraftModel.findFirst({
				where: {
					providerId: { eq: job.target.providerId },
					modelName: { eq: job.target.modelName },
					status: { eq: "active" },
				},
				columns: { id: true },
			});
			const history: Verification[] = [];
			// Raw timestamp expressions need UTC strings, not driver-local Date encoding.
			let before = job.createdAt.toISOString();
			let beforeId = job.id;
			while (true) {
				const page = await tx
					.select()
					.from(verifications)
					.where(
						and(
							or(
								eq(
									verifications.modelProviderMappingId,
									job.modelProviderMappingId!,
								),
								...(listing
									? [eq(verifications.draftModelId, listing.id)]
									: []),
							),
							or(
								lt(
									sql`date_trunc('milliseconds', ${verifications.createdAt})`,
									before,
								),
								and(
									eq(
										sql`date_trunc('milliseconds', ${verifications.createdAt})`,
										before,
									),
									lt(verifications.id, beforeId),
								),
							),
							inArray(verifications.status, ["passed", "failed"]),
						),
					)
					.orderBy(
						sql`date_trunc('milliseconds', ${verifications.createdAt}) DESC`,
						sql`${verifications.id} DESC`,
					)
					.limit(100);
				history.push(...page);
				if (page.length < 100) {
					break;
				}
				before = page[page.length - 1].createdAt.toISOString();
				beforeId = page[page.length - 1].id;
			}
			const checks = regressedVerificationChecks(job, history);
			if (!checks.length) {
				await finish();
				return 0;
			}
			let retryMs = RETRY_MS;
			try {
				const response = await fetchImplementation(webhook, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(modelVerificationRegressionPayload(job, checks)),
					signal: AbortSignal.timeout(5000),
					redirect: "error",
				});
				await response.body?.cancel();
				if (response.ok) {
					await finish();
					return 1;
				}
				const retryAfter = response.headers.get("retry-after");
				const seconds = Number(retryAfter);
				const delay = Number.isFinite(seconds)
					? seconds * 1000
					: Date.parse(retryAfter ?? "") - now.getTime();
				if (Number.isFinite(delay)) {
					retryMs = Math.max(RETRY_MS, Math.min(delay, RETENTION_MS));
				}
				logger.warn("Model verification alert delivery failed", {
					verificationId: job.id,
					status: response.status,
				});
			} catch {
				// Fetch errors can contain the secret webhook URL; never log them.
				logger.warn("Model verification alert delivery failed", {
					verificationId: job.id,
				});
			}
			await tx
				.update(progress)
				.set({ refreshedAt: new Date(now.getTime() + retryMs) })
				.where(and(eq(progress.job, key), eq(progress.bucketTimestamp, EPOCH)));
			return 0;
		});
	}
	return delivered;
}
