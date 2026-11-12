import {
	DAILY_KEY_CHECK_PREFIX,
	createQueuedModelVerificationChecks,
	isDailyModelVerification,
	providerVerificationCredentialFingerprint,
} from "@llmgateway/actions";
import {
	and,
	asc,
	db,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	notLike,
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
	currentVerificationTarget,
	sameVerificationCredential,
	dailyKeyCheckId,
	managedVerificationProviderKeys,
} from "./daily-model-verifications.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

type Verification = typeof tables.providerModelVerification.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const RETRY_MS = 5 * 60 * 1000;
// How long an alert waits for the other managed keys' re-runs to finish.
const KEY_CHECK_WAIT_MS = 24 * 60 * 60 * 1000;
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

function keyLabel(run: Verification): string {
	return publicIdentifier(run.target.providerKeyId ?? run.credentialSource);
}

function keyResults(job: Verification, runs: Verification[]): string {
	return [job, ...runs]
		.map((run) => keyLabel(run) + " (" + run.status + ")")
		.join(", ")
		.slice(0, 1000);
}

export function modelVerificationRegressionPayload(
	job: Verification,
	checks: string[],
	keyRuns: Verification[] = [],
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
					{ name: "Failing on every key", value: keyResults(job, keyRuns) },
					{ name: "Verification", value: job.id },
				],
				timestamp: job.completedAt?.toISOString(),
			},
		],
	};
}

/** One managed key fails checks another managed key passes. */
export function managedKeyFailurePayload(
	job: Verification,
	checks: string[],
	keyRuns: Verification[],
) {
	return {
		allowed_mentions: { parse: [] },
		embeds: [
			{
				title: "Managed provider key failing verification",
				description: publicIdentifier(job.target.providerId),
				fields: [
					{ name: "Key", value: keyLabel(job) },
					{
						name: "First failing mapping",
						value:
							publicIdentifier(job.target.modelName) +
							" (" +
							(publicIdentifier(job.target.region ?? "default") || "default") +
							")",
					},
					{ name: "Failing checks", value: checks.join(", ").slice(0, 1000) },
					{ name: "Keys", value: keyResults(job, keyRuns) },
					{ name: "Verification", value: job.id },
				],
				timestamp: job.completedAt?.toISOString(),
			},
		],
	};
}

/**
 * A managed daily run only proves its own key. Queue the same checks on every
 * other managed key that serves the mapping, so a broken key is not reported
 * as a broken model.
 */
async function queueKeyChecks(
	job: Verification,
	tx: Transaction,
	queue: boolean,
): Promise<{ runs: Verification[]; pending: boolean }> {
	const keyId = job.target.providerKeyId;
	if (
		job.credentialSource !== "managed" ||
		!keyId ||
		!job.modelProviderMappingId
	) {
		return { runs: [], pending: false };
	}
	const keys = await managedVerificationProviderKeys(
		{ ...job.target, providerKeyId: undefined },
		tx,
	);
	const runs: Verification[] = [];
	let pending = false;
	for (const key of keys) {
		if (key.id === keyId) {
			continue;
		}
		const credentialFingerprint =
			providerVerificationCredentialFingerprint(key);
		// The fingerprint keeps a rotated key from reusing its old result.
		const id = dailyKeyCheckId(
			job.modelProviderMappingId,
			key.id + ":" + credentialFingerprint,
			job.createdAt,
		);
		const target = {
			...job.target,
			providerKeyId: key.id,
			credentialFingerprint,
			gatewayExecutionVersion: undefined,
		};
		if (queue) {
			await tx
				.insert(verifications)
				.values({
					id,
					modelProviderMappingId: job.modelProviderMappingId,
					initiatedBy: "admin",
					target,
					checks: createQueuedModelVerificationChecks(target),
					credentialSource: "managed",
				})
				.onConflictDoNothing();
		}
		const run = await tx.query.providerModelVerification.findFirst({
			where: { id: { eq: id } },
		});
		if (run) {
			runs.push(run);
			pending ||= run.status === "queued" || run.status === "running";
		} else {
			// One active run per mapping: this key queues once the current run ends.
			pending = true;
		}
	}
	return { runs, pending };
}

function passesCheck(run: Verification, id: string): boolean {
	return run.checks.some(
		(check) =>
			check.id === id &&
			check.status === "passed" &&
			!check.probes?.some((probe) => probe.status === "failed"),
	);
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
				notLike(verifications.id, DAILY_KEY_CHECK_PREFIX + "%"),
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
				!sameVerificationDeclaration(
					job.target,
					live.target,
					isDailyModelVerification(job),
				) ||
				!sameVerificationCredential(
					job.target,
					await currentVerificationTarget(live, tx),
				) ||
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
							notLike(verifications.id, DAILY_KEY_CHECK_PREFIX + "%"),
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
			const retryLater = async (ms: number) => {
				await tx
					.update(progress)
					.set({ refreshedAt: new Date(now.getTime() + ms) })
					.where(
						and(eq(progress.job, key), eq(progress.bucketTimestamp, EPOCH)),
					);
			};
			const waiting =
				now.getTime() - job.createdAt.getTime() < KEY_CHECK_WAIT_MS;
			const { runs: keyRuns, pending } = await queueKeyChecks(job, tx, waiting);
			if (waiting && pending) {
				await retryLater(RETRY_MS);
				return 0;
			}
			const send = async (payload: unknown) => {
				try {
					const response = await fetchImplementation(webhook, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload),
						signal: AbortSignal.timeout(5000),
						redirect: "error",
					});
					await response.body?.cancel();
					if (response.ok) {
						return 0;
					}
					logger.warn("Model verification alert delivery failed", {
						verificationId: job.id,
						status: response.status,
					});
					const retryAfter = response.headers.get("retry-after");
					const seconds = Number(retryAfter);
					const delay = Number.isFinite(seconds)
						? seconds * 1000
						: Date.parse(retryAfter ?? "") - now.getTime();
					return Number.isFinite(delay)
						? Math.max(RETRY_MS, Math.min(delay, RETENTION_MS))
						: RETRY_MS;
				} catch {
					// Fetch errors can contain the secret webhook URL; never log them.
					logger.warn("Model verification alert delivery failed", {
						verificationId: job.id,
					});
					return RETRY_MS;
				}
			};
			// A model regression must fail on every key; otherwise the key is broken.
			const everyKey = checks.filter(
				(id) => !keyRuns.some((run) => passesCheck(run, id)),
			);
			if (everyKey.length) {
				const retryMs = await send(
					modelVerificationRegressionPayload(job, everyKey, keyRuns),
				);
				if (!retryMs) {
					await finish();
					return 1;
				}
				await retryLater(retryMs);
				return 0;
			}
			// Alert each failing key once per day, the daily key and any alternate.
			let sent = 0;
			let retryMs = 0;
			for (const run of [job, ...keyRuns]) {
				const failed = checks.filter((id) => !passesCheck(run, id));
				if (!failed.length || !run.target.providerKeyId) {
					continue;
				}
				const keyAlert =
					"daily-verification-key-alert:" +
					job.createdAt.toISOString().slice(0, 10) +
					":" +
					run.target.providerKeyId;
				await tx
					.insert(progress)
					.values({ job: keyAlert, bucketTimestamp: EPOCH })
					.onConflictDoNothing();
				const [keyState] = await tx
					.select()
					.from(progress)
					.where(
						and(
							eq(progress.job, keyAlert),
							eq(progress.bucketTimestamp, EPOCH),
						),
					)
					.for("update");
				if (keyState?.finalizedAt) {
					continue;
				}
				const delay = await send(
					managedKeyFailurePayload(
						run,
						failed,
						[job, ...keyRuns].filter((other) => other !== run),
					),
				);
				if (delay) {
					retryMs = Math.max(retryMs, delay);
					continue;
				}
				sent++;
				await tx
					.update(progress)
					.set({ finalizedAt: now, refreshedAt: now })
					.where(
						and(
							eq(progress.job, keyAlert),
							eq(progress.bucketTimestamp, EPOCH),
						),
					);
			}
			if (retryMs) {
				await retryLater(retryMs);
			} else {
				await finish();
			}
			return sent;
		});
	}
	return delivered;
}
