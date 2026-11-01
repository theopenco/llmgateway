import { createHash, randomUUID, createHmac } from "node:crypto";

import {
	buildVerificationTarget,
	createQueuedModelVerificationChecks,
} from "@llmgateway/actions";
import { and, db, desc, eq, isNull, like, or, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";
import {
	fromEmail,
	getResendClient,
	replyToEmail,
} from "@llmgateway/shared/email";

import {
	liveVerificationMapping,
	sameVerificationDeclaration,
} from "./daily-model-verifications.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Verification = typeof tables.providerModelVerification.$inferSelect;
type Kind = "failure" | "recovery";
interface Reference {
	mappingId: string;
	verificationId: string;
}
interface Attempt {
	id: string;
	kind: Kind;
	models: Reference[];
	users: string[];
	digest: string;
}
export interface AirsideVerificationEmail {
	to: string[];
	subject: string;
	text: string;
	idempotencyKey: string;
}
export type AirsideVerificationEmailSender = (
	email: AirsideVerificationEmail,
) => Promise<boolean>;
export interface AirsideVerificationObservation {
	mappingId: string;
	verificationId: string | null;
	declaration: string;
	completedAt: Date | null;
	status: "failed" | "healthy" | "unknown";
	failedChecks: string[];
	providerId: string;
	modelId: string;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH = new Date(0);
const progress = tables.aggregationProgress;
const jobs = tables.providerModelVerification;
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const prefix = (companyId: string) =>
	"airside-verification-email:" + hash(companyId) + ":";
const declaration = (target: ProviderModelVerificationTarget) =>
	hash(JSON.stringify(buildVerificationTarget(target)));

/** Recovery requires later passing evidence for every notified listing. */
export function chooseAirsideVerificationEmail(
	observations: AirsideVerificationObservation[],
	notified: AirsideVerificationObservation[],
	lastFailureAt: Date | null,
	now: Date,
): Kind | null {
	if (observations.some((item) => item.status === "failed")) {
		return !lastFailureAt || now.getTime() - lastFailureAt.getTime() >= DAY_MS
			? "failure"
			: null;
	}
	if (
		!observations.length ||
		observations.some((item) => item.status !== "healthy")
	) {
		return null;
	}
	const activeNotified = notified.filter((old) =>
		observations.some((current) => current.mappingId === old.mappingId),
	);
	return activeNotified.length > 0 &&
		activeNotified.every((old) =>
			observations.some(
				(current) =>
					current.mappingId === old.mappingId &&
					current.completedAt &&
					old.completedAt &&
					current.completedAt > old.completedAt &&
					current.verificationId !== old.verificationId,
			),
		)
		? "recovery"
		: null;
}

function observation(
	mappingId: string,
	target: ProviderModelVerificationTarget,
	job?: Verification,
): AirsideVerificationObservation {
	const expected = createQueuedModelVerificationChecks(target);
	const compatible = job && sameVerificationDeclaration(target, job.target);
	const failedChecks =
		compatible &&
		job.completedAt &&
		(job.status === "failed" || job.status === "passed")
			? expected
					.filter((check) =>
						job.checks.some(
							(actual) =>
								actual.id === check.id &&
								(actual.status === "failed" ||
									actual.probes?.some((probe) => probe.status === "failed")),
						),
					)
					.map((check) => check.label)
			: [];
	const healthy =
		compatible &&
		job.status === "passed" &&
		job.completedAt &&
		expected.length > 0 &&
		expected.every((check) =>
			job.checks.some(
				(actual) =>
					actual.id === check.id &&
					actual.status === "passed" &&
					!actual.probes?.some((probe) => probe.status === "failed"),
			),
		);
	return {
		mappingId,
		verificationId: job?.id ?? null,
		declaration: declaration(target),
		completedAt: job?.completedAt ?? null,
		status: failedChecks.length ? "failed" : healthy ? "healthy" : "unknown",
		failedChecks,
		providerId: target.providerId,
		modelId: target.modelName,
	};
}

async function observations(companyId: string, now: Date, tx: Transaction) {
	const claims = await tx.query.providerClaim.findMany({
		where: { providerCompanyId: { eq: companyId }, status: { eq: "active" } },
	});
	const result: AirsideVerificationObservation[] = [];
	for (const claim of claims) {
		if (!claim.verificationKeyCiphertext) {
			continue;
		}
		const mappings = await tx.query.modelProviderMapping.findMany({
			where: { providerId: { eq: claim.providerId }, status: { eq: "active" } },
		});
		for (const mapping of mappings) {
			const live = await liveVerificationMapping(mapping.id, now, tx);
			if (
				!live ||
				live.claim?.providerCompanyId !== companyId ||
				!live.claim.verificationKeyCiphertext
			) {
				continue;
			}
			const [job] = await tx
				.select()
				.from(jobs)
				.where(
					and(
						eq(jobs.providerCompanyId, companyId),
						or(
							eq(jobs.modelProviderMappingId, mapping.id),
							live.draftModelId
								? and(
										isNull(jobs.modelProviderMappingId),
										eq(jobs.draftModelId, live.draftModelId),
									)
								: undefined,
						),
					),
				)
				.orderBy(desc(jobs.createdAt), desc(jobs.id))
				.limit(1);
			result.push(observation(mapping.id, live.target, job));
		}
	}
	return result.sort((a, b) => a.mappingId.localeCompare(b.mappingId));
}

async function referenced(models: Reference[], tx: Transaction) {
	const result: AirsideVerificationObservation[] = [];
	for (const model of models) {
		const job = await tx.query.providerModelVerification.findFirst({
			where: { id: { eq: model.verificationId } },
		});
		if (!job) {
			return null;
		}
		result.push(observation(model.mappingId, job.target, job));
	}
	return result;
}

function reserved(email: string) {
	const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
	return [
		"example",
		"invalid",
		"localhost",
		"test",
		"example.com",
		"example.net",
		"example.org",
	].some((suffix) => domain === suffix || domain.endsWith("." + suffix));
}

async function recipients(companyId: string, tx: Transaction) {
	const members = await tx
		.select({ id: tables.user.id, email: tables.user.email })
		.from(tables.providerCompanyMember)
		.innerJoin(
			tables.user,
			eq(tables.providerCompanyMember.userId, tables.user.id),
		)
		.where(
			and(
				eq(tables.providerCompanyMember.providerCompanyId, companyId),
				eq(tables.user.emailVerified, true),
				eq(tables.user.status, "active"),
			),
		);
	const addresses = new Set<string>();
	return members
		.sort((a, b) => a.id.localeCompare(b.id))
		.filter((member) => {
			const address = member.email.trim().toLowerCase();
			if (
				!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
				(process.env.NODE_ENV === "production" && reserved(address)) ||
				addresses.has(address)
			) {
				return false;
			}
			addresses.add(address);
			return true;
		})
		.map((member) => ({
			id: member.id,
			email: member.email.trim().toLowerCase(),
		}));
}

function message(
	kind: Kind,
	models: AirsideVerificationObservation[],
	to: string[],
) {
	const safeId = (value: string) => encodeURIComponent(value);
	const lines = models.map(
		(model) =>
			"- " +
			safeId(model.providerId) +
			"/" +
			safeId(model.modelId) +
			" (listing " +
			safeId(model.mappingId) +
			")" +
			(kind === "failure" ? ": " + model.failedChecks.join(", ") : ""),
	);
	return {
		to,
		subject:
			kind === "failure"
				? "Airside model verification failed"
				: "Airside model verification recovered",
		text:
			(kind === "failure"
				? "Verification failed for these active listings:"
				: "Subsequent verification confirmed these previously reported listings are working again:") +
			"\n\n" +
			lines.join("\n") +
			"\n\nReview verification status in Airside: https://airside.llmgateway.io/\n",
	};
}
const payloadDigest = (
	email: Omit<AirsideVerificationEmail, "idempotencyKey">,
) =>
	createHmac("sha256", getApiKeyHashSecret())
		.update(
			"airside-verification-email:v1:" +
				JSON.stringify({ fromEmail, replyToEmail, ...email }),
		)
		.digest("hex");
async function attemptData(
	job: string,
	companyId: string,
	tx: Transaction,
): Promise<Attempt> {
	const header = attemptHeader(job, companyId);
	const key = prefix(companyId) + "data:" + header.id + ":";
	const rows = await tx
		.select({ job: progress.job })
		.from(progress)
		.where(like(progress.job, key + "%"))
		.orderBy(progress.job);
	const models: Reference[] = [];
	const users: string[] = [];
	for (const row of rows) {
		const value = JSON.parse(
			Buffer.from(row.job.slice(key.length + 10), "base64url").toString("utf8"),
		) as { model?: Reference; user?: string };
		if (value.model) {
			models.push(value.model);
		}
		if (value.user) {
			users.push(value.user);
		}
	}
	return { ...header, models, users };
}
const attemptJob = (companyId: string, attempt: Attempt) =>
	prefix(companyId) +
	"attempt:" +
	Buffer.from(
		JSON.stringify({
			id: attempt.id,
			kind: attempt.kind,
			digest: attempt.digest,
		}),
	).toString("base64url");

async function lock(companyId: string, tx: Transaction) {
	const [state] = await tx
		.select()
		.from(progress)
		.where(
			and(
				eq(progress.job, prefix(companyId) + "state"),
				eq(progress.bucketTimestamp, EPOCH),
			),
		)
		.for("update", { skipLocked: true });
	return state;
}

async function prepare(companyId: string, now: Date) {
	await db
		.insert(progress)
		.values({ job: prefix(companyId) + "state", bucketTimestamp: EPOCH })
		.onConflictDoNothing();
	return await db.transaction(async (tx) => {
		const state = await lock(companyId, tx);
		if (!state) {
			return null;
		}
		const attempts = await tx
			.select()
			.from(progress)
			.where(like(progress.job, prefix(companyId) + "attempt:%"));
		const pending = attempts.find((row) => !row.finalizedAt);
		if (pending) {
			return pending;
		}
		const current = await observations(companyId, now, tx);
		const notified: AirsideVerificationObservation[] = [];
		for (const row of attempts) {
			const attempt = await attemptData(row.job, companyId, tx);
			if (
				attempt.kind !== "failure" ||
				!row.finalizedAt ||
				row.finalizedAt.getTime() === 0 ||
				(state.finalizedAt && row.finalizedAt <= state.finalizedAt)
			) {
				continue;
			}
			const previous = await referenced(attempt.models, tx);
			if (previous) {
				notified.push(...previous);
			} else {
				// Missing history blocks recovery, not unrelated future failure notifications.
				notified.push(
					...attempt.models.map((model) => ({
						...model,
						declaration: "",
						completedAt: null,
						status: "unknown" as const,
						failedChecks: [],
						providerId: "",
						modelId: "",
					})),
				);
			}
		}
		const reservations = attempts
			.filter(
				(row) =>
					row.finalizedAt?.getTime() === 0 &&
					row.refreshedAt &&
					attemptHeader(row.job, companyId).kind === "failure",
			)
			.map((row) => row.refreshedAt!);
		const lastFailure =
			[state.refreshedAt, ...reservations]
				.filter((value): value is Date => value !== null)
				.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
		const kind = chooseAirsideVerificationEmail(
			current,
			notified,
			lastFailure,
			now,
		);
		if (!kind) {
			return null;
		}
		const members = await recipients(companyId, tx);
		if (!members.length) {
			return null;
		}
		const affected =
			kind === "failure"
				? current.filter((item) => item.status === "failed")
				: current.filter((item) =>
						notified.some((old) => old.mappingId === item.mappingId),
					);
		const attempt: Attempt = {
			id: randomUUID(),
			kind,
			models: affected.map((item) => ({
				mappingId: item.mappingId,
				verificationId: item.verificationId!,
			})),
			users: members.map((member) => member.id),
			digest: payloadDigest(
				message(
					kind,
					affected,
					members.map((member) => member.email),
				),
			),
		};
		const metadata = [
			...attempt.models.map((model) => ({ model })),
			...attempt.users.map((user) => ({ user })),
		];
		for (let offset = 0; offset < metadata.length; offset += 200) {
			await tx.insert(progress).values(
				metadata.slice(offset, offset + 200).map((value, index) => ({
					job:
						prefix(companyId) +
						"data:" +
						attempt.id +
						":" +
						String(offset + index).padStart(9, "0") +
						":" +
						Buffer.from(JSON.stringify(value)).toString("base64url"),
					bucketTimestamp: now,
				})),
			);
		}
		const [row] = await tx
			.insert(progress)
			.values({
				job: attemptJob(companyId, attempt),
				bucketTimestamp: now,
				refreshedAt: null,
			})
			.returning();
		return row;
	});
}

async function deliver(
	companyId: string,
	now: Date,
	pending: typeof progress.$inferSelect,
	sender: AirsideVerificationEmailSender,
) {
	return await db.transaction(async (tx) => {
		const state = await lock(companyId, tx);
		if (!state) {
			return 0;
		}
		const row = await tx.query.aggregationProgress.findFirst({
			where: {
				job: { eq: pending.job },
				bucketTimestamp: { eq: pending.bucketTimestamp },
			},
		});
		if (!row || row.finalizedAt) {
			return 0;
		}
		const attempt = await attemptData(row.job, companyId, tx);
		const retire = async () => {
			await tx
				.update(progress)
				.set({ finalizedAt: EPOCH })
				.where(
					and(
						eq(progress.job, row.job),
						eq(progress.bucketTimestamp, row.bucketTimestamp),
					),
				);
			if (attempt.kind === "recovery" && row.refreshedAt) {
				await tx
					.update(progress)
					.set({ finalizedAt: now })
					.where(
						and(
							eq(progress.job, state.job),
							eq(progress.bucketTimestamp, EPOCH),
						),
					);
			}
			return 0;
		};
		// A retired ambiguous failure reserves quota, but is never treated as a delivered incident.
		if (now.getTime() - row.bucketTimestamp.getTime() >= DAY_MS) {
			logger.error(
				"Airside verification email attempt retired after idempotency expiry.",
			);
			return await retire();
		}
		const frozen = await referenced(attempt.models, tx);
		const current = await observations(companyId, now, tx);
		if (
			!frozen ||
			frozen.some(
				(old) =>
					!current.some(
						(item) =>
							item.mappingId === old.mappingId &&
							item.declaration === old.declaration,
					),
			)
		) {
			return await retire();
		}
		if (
			attempt.kind === "recovery" &&
			current.some((item) => item.status !== "healthy")
		) {
			return await retire();
		}
		if (
			attempt.kind === "failure" &&
			frozen.some(
				(old) =>
					!current.some(
						(item) =>
							item.mappingId === old.mappingId && item.status === "failed",
					),
			)
		) {
			return await retire();
		}
		const members = await recipients(companyId, tx);
		const selected = attempt.users.map((id) =>
			members.find((member) => member.id === id),
		);
		if (
			!selected.length ||
			selected.length !== members.length ||
			selected.some((member) => !member)
		) {
			return await retire();
		}
		const email = message(
			attempt.kind,
			frozen,
			selected.map((member) => member!.email),
		);
		if (payloadDigest(email) !== attempt.digest) {
			return await retire();
		}
		// Commit the dispatch reservation separately so a crash after acceptance cannot erase it.
		const dispatchAt = new Date(Math.max(now.getTime(), Date.now()));
		await db
			.update(progress)
			.set({ refreshedAt: dispatchAt })
			.where(
				and(
					eq(progress.job, row.job),
					eq(progress.bucketTimestamp, row.bucketTimestamp),
				),
			);
		let accepted: boolean;
		try {
			accepted = await sendWithDeadline(sender, {
				...email,
				idempotencyKey: "airside-verification-" + attempt.id,
			});
		} catch {
			const failedAt = new Date(Math.max(dispatchAt.getTime(), Date.now()));
			await db
				.update(progress)
				.set({ refreshedAt: failedAt })
				.where(
					and(
						eq(progress.job, row.job),
						eq(progress.bucketTimestamp, row.bucketTimestamp),
					),
				);
			throw new Error("Airside verification email delivery failed.");
		}
		if (!accepted) {
			await tx
				.update(progress)
				.set({ refreshedAt: row.refreshedAt })
				.where(
					and(
						eq(progress.job, row.job),
						eq(progress.bucketTimestamp, row.bucketTimestamp),
					),
				);
			return 0;
		}
		const deliveredAt = new Date(Math.max(now.getTime(), Date.now()));
		await tx
			.update(progress)
			.set({ finalizedAt: deliveredAt })
			.where(
				and(
					eq(progress.job, row.job),
					eq(progress.bucketTimestamp, row.bucketTimestamp),
				),
			);
		await tx
			.update(progress)
			.set(
				attempt.kind === "failure"
					? { refreshedAt: deliveredAt }
					: { finalizedAt: deliveredAt },
			)
			.where(
				and(eq(progress.job, state.job), eq(progress.bucketTimestamp, EPOCH)),
			);
		return 1;
	});
}

function configuredSender(): AirsideVerificationEmailSender | null {
	if (process.env.NODE_ENV !== "production") {
		return null;
	}
	const client = getResendClient();
	if (!client) {
		return null;
	}
	return async (email) => {
		// Retry every batch with the same key after partial delivery or an ambiguous crash.
		for (let offset = 0; offset < email.to.length; offset += 50) {
			const { data, error } = await client.emails.send(
				{
					from: fromEmail,
					replyTo: replyToEmail,
					to: email.to.slice(offset, offset + 50),
					subject: email.subject,
					text: email.text,
				},
				{ idempotencyKey: email.idempotencyKey + ":" + offset },
			);
			if (error || !data?.id) {
				throw new Error("Airside verification email delivery failed.");
			}
		}
		return true;
	};
}

/** Transactional carrier status mail; independent of Discord and disabled by default. */
export async function deliverAirsideVerificationEmails(
	now = new Date(),
	injectedSender?: AirsideVerificationEmailSender,
): Promise<number> {
	if (process.env.AIRSIDE_VERIFICATION_EMAIL_ENABLED !== "true") {
		return 0;
	}
	const sender = injectedSender ?? configuredSender();
	if (!sender) {
		return 0;
	}
	let sent = 0;
	let cursor = "";
	while (true) {
		const companies = await db.query.providerCompany.findMany({
			where: { id: { gt: cursor } },
			orderBy: { id: "asc" },
			columns: { id: true },
			limit: 100,
		});
		if (!companies.length) {
			return sent;
		}
		for (const company of companies) {
			try {
				const pending = await prepare(company.id, now);
				if (pending) {
					sent += await deliver(company.id, now, pending, sender);
				}
			} catch {
				// Upstream errors can contain addresses or request bodies; retain the attempt without logging them.
				logger.error(
					"Airside verification email delivery failed; retained for retry.",
				);
			}
		}
		cursor = companies[companies.length - 1].id;
	}
}
function attemptHeader(
	job: string,
	companyId: string,
): Pick<Attempt, "id" | "kind" | "digest"> {
	return JSON.parse(
		Buffer.from(
			job.slice((prefix(companyId) + "attempt:").length),
			"base64url",
		).toString("utf8"),
	) as Pick<Attempt, "id" | "kind" | "digest">;
}
const EMAIL_SEND_TIMEOUT_MS = 10_000;
async function sendWithDeadline(
	sender: AirsideVerificationEmailSender,
	email: AirsideVerificationEmail,
): Promise<boolean> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			sender(email),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() =>
						reject(new Error("Airside verification email delivery timed out.")),
					EMAIL_SEND_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}
