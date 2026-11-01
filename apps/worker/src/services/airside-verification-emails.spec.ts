import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	createQueuedModelVerificationChecks,
	mappingTarget,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getResendClient } from "@llmgateway/shared/email";

import {
	chooseAirsideVerificationEmail,
	deliverAirsideVerificationEmails,
} from "./airside-verification-emails.js";

import type {
	AirsideVerificationEmail,
	AirsideVerificationEmailSender,
	AirsideVerificationObservation,
} from "./airside-verification-emails.js";

process.env.GATEWAY_API_KEY_HASH_SECRET = "carrier-email-test-secret";

vi.mock("@llmgateway/shared/email", () => ({
	fromEmail: "sender@example.com",
	replyToEmail: "reply@example.com",
	getResendClient: vi.fn(() => null),
}));
vi.mock("@llmgateway/logger", () => ({
	logger: {
		error: vi.fn(),
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));
const now = new Date("2028-06-01T23:30:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(now.getTime() + ms);
const companies: string[] = [];
const users: string[] = [];
const providers: string[] = [];
const models: string[] = [];
const sender = vi.fn<AirsideVerificationEmailSender>();

beforeEach(async () => {
	vi.clearAllMocks();
	vi.stubEnv("NODE_ENV", "test");
	vi.stubEnv("AIRSIDE_VERIFICATION_EMAIL_ENABLED", "true");
	await db.delete(tables.providerModelVerification);
	await db.delete(tables.aggregationProgress);
	sender.mockResolvedValue(true);
});
afterEach(async () => {
	await db.delete(tables.providerModelVerification);
	await db.delete(tables.aggregationProgress);
	for (const id of companies.splice(0)) {
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, id));
	}
	for (const id of providers.splice(0)) {
		await db.delete(tables.provider).where(eq(tables.provider.id, id));
	}
	for (const id of models.splice(0)) {
		await db.delete(tables.model).where(eq(tables.model.id, id));
	}
	for (const id of users.splice(0)) {
		await db.delete(tables.user).where(eq(tables.user.id, id));
	}
	vi.unstubAllEnvs();
});

async function member(
	companyId: string,
	email = randomUUID() + "@example.com",
	verified = true,
	status: "active" | "deactivated" = "active",
) {
	const id = randomUUID();
	users.push(id);
	await db
		.insert(tables.user)
		.values({ id, email, emailVerified: verified, status });
	await db
		.insert(tables.providerCompanyMember)
		.values({ providerCompanyId: companyId, userId: id });
	return { id, email };
}
async function seed(existing?: {
	companyId: string;
	providerId: string;
	userId: string;
}) {
	const companyId = existing?.companyId ?? randomUUID();
	const providerId = existing?.providerId ?? "email-provider-" + randomUUID();
	let userId = existing?.userId ?? "";
	if (!existing) {
		companies.push(companyId);
		providers.push(providerId);
		await db
			.insert(tables.providerCompany)
			.values({ id: companyId, name: "Verification Company" });
		userId = (await member(companyId)).id;
		await db.insert(tables.provider).values({
			id: providerId,
			name: "Verification Provider",
			description: "Test provider",
		});
		await db.insert(tables.providerClaim).values({
			providerCompanyId: companyId,
			providerId,
			kind: "custom",
			matchedDomain: "example.com",
			status: "active",
			claimedBy: userId,
			verificationKeyCiphertext: "fixture-ciphertext",
		});
	}
	const modelId = "email-model-" + randomUUID();
	models.push(modelId);
	await db.insert(tables.model).values({
		id: modelId,
		name: "Verification Model",
		family: "verification",
	});
	const [mapping] = await db
		.insert(tables.modelProviderMapping)
		.values({
			modelId,
			providerId,
			externalId: modelId,
			source: "airside",
			streaming: false,
		})
		.returning();
	const [draft] = await db
		.insert(tables.providerDraftModel)
		.values({
			providerCompanyId: companyId,
			providerId,
			modelName: modelId,
			externalId: modelId,
			status: "active",
			streaming: false,
		})
		.returning();
	return { companyId, providerId, userId, modelId, mapping, draft };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function verify(
	fixture: Fixture,
	status: "passed" | "failed" | "queued" | "running" | "skipped",
	date = now,
	manual = false,
) {
	const target = mappingTarget(fixture.mapping);
	const checks = createQueuedModelVerificationChecks(target).map((check) => ({
		...check,
		status: "passed" as const,
	}));
	const values = checks.map((check, index) =>
		index === 0
			? {
					...check,
					status:
						status === "skipped"
							? ("skipped" as const)
							: status === "failed"
								? ("failed" as const)
								: status === "queued"
									? ("queued" as const)
									: status === "running"
										? ("running" as const)
										: ("passed" as const),
					label: "untrusted label",
					feedback: "private upstream feedback",
					probes:
						status === "failed"
							? [
									{
										label: "private probe",
										status: "failed" as const,
										feedback: "private response",
									},
								]
							: undefined,
				}
			: check,
	);
	const [job] = await db
		.insert(tables.providerModelVerification)
		.values({
			id: randomUUID(),
			providerCompanyId: fixture.companyId,
			modelProviderMappingId: manual ? null : fixture.mapping.id,
			draftModelId: fixture.draft.id,
			initiatedBy: manual ? "carrier" : "admin",
			target,
			checks: values,
			status: status === "skipped" ? "passed" : status,
			createdAt: date,
			completedAt: status === "queued" || status === "running" ? null : date,
			credentialSource: "carrier",
			summary: "private summary",
		})
		.returning();
	return job;
}
const observed = (
	overrides: Partial<AirsideVerificationObservation> = {},
): AirsideVerificationObservation => ({
	mappingId: "mapping",
	verificationId: "failed-run",
	declaration: "declaration",
	completedAt: now,
	status: "failed",
	failedChecks: ["Basic completion"],
	providerId: "provider",
	modelId: "model",
	...overrides,
});

describe("carrier email state", () => {
	it("uses rolling elapsed hours, including across midnight and after recovery", () => {
		expect(chooseAirsideVerificationEmail([observed()], [], null, now)).toBe(
			"failure",
		);
		expect(
			chooseAirsideVerificationEmail([observed()], [], now, at(60 * 60 * 1000)),
		).toBeNull();
		expect(
			chooseAirsideVerificationEmail([observed()], [], now, at(DAY_MS)),
		).toBe("failure");
	});
	it("requires later compatible proof for every notified listing and every relevant listing healthy", () => {
		const healthy = observed({
			status: "healthy",
			verificationId: "later-run",
			completedAt: at(1000),
		});
		expect(
			chooseAirsideVerificationEmail([healthy], [observed()], now, at(1000)),
		).toBe("recovery");
		for (const current of [
			[],
			[healthy, observed({ mappingId: "other", status: "unknown" })],
			[healthy, observed({ mappingId: "other" })],
			[observed({ ...healthy, completedAt: now })],
		]) {
			expect(
				chooseAirsideVerificationEmail(current, [observed()], now, at(1000)),
			).toBeNull();
		}
		expect(
			chooseAirsideVerificationEmail([healthy], [], now, at(1000)),
		).toBeNull();
		expect(
			chooseAirsideVerificationEmail(
				[{ ...healthy, declaration: "updated-current-declaration" }],
				[observed()],
				now,
				at(1000),
			),
		).toBe("recovery");
	});
});

describe("carrier verification mail delivery", () => {
	it("is opt-in, independent of Discord, and never sends by default outside production", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		vi.stubEnv("AIRSIDE_VERIFICATION_EMAIL_ENABLED", "false");
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		vi.stubEnv("AIRSIDE_VERIFICATION_EMAIL_ENABLED", "true");
		expect(await deliverAirsideVerificationEmails(now)).toBe(0);
		expect(getResendClient).not.toHaveBeenCalled();
		expect(sender).not.toHaveBeenCalled();
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(1);
	});
	it("aggregates actual failures without a historical pass, sends only safe operational content to verified current members", async () => {
		const first = await seed();
		const second = await seed(first);
		await verify(first, "failed");
		await verify(second, "failed");
		await member(first.companyId, "crew@example.com");
		await member(first.companyId, "CREW@example.com");
		await member(first.companyId, "unverified@example.com", false);
		await member(first.companyId, "inactive@example.com", true, "deactivated");
		await db.insert(tables.providerCompanyInvite).values({
			providerCompanyId: first.companyId,
			email: "invited@example.com",
			invitedBy: first.userId,
		});
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(1);
		const email = sender.mock.calls[0][0];
		expect(email.to).toHaveLength(2);
		expect(email.to).toContain("crew@example.com");
		expect(email.text).toContain(first.modelId);
		expect(email.text).toContain(second.modelId);
		expect(email.text).toContain("https://airside.llmgateway.io/");
		expect(email.text).toContain(
			createQueuedModelVerificationChecks(mappingTarget(first.mapping))[0]
				.label,
		);
		for (const unsafe of [
			"private",
			"untrusted label",
			"fixture-ciphertext",
			"unsubscribe",
		]) {
			expect(JSON.stringify(email)).not.toContain(unsafe);
		}
	});
	it("serializes competing replicas and retains rolling cooldown across restarts and recovery", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		expect(
			(
				await Promise.all([
					deliverAirsideVerificationEmails(now, sender),
					deliverAirsideVerificationEmails(now, sender),
				])
			).reduce((sum, value) => sum + value, 0),
		).toBe(1);
		expect(sender).toHaveBeenCalledTimes(1);
		await verify(fixture, "passed", at(1000), true);
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(1);
		expect(sender.mock.calls[1][0].subject).toContain("recovered");
		expect(await deliverAirsideVerificationEmails(at(2000), sender)).toBe(0);
		await verify(fixture, "failed", at(3000));
		expect(await deliverAirsideVerificationEmails(at(3000), sender)).toBe(0);
		await verify(fixture, "passed", at(4000));
		expect(await deliverAirsideVerificationEmails(at(4000), sender)).toBe(0);
		await verify(fixture, "failed", at(DAY_MS + 1000));
		expect(
			await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
		).toBe(1);
	});
	it("waits for every relevant listing and never treats queued/running/skipped results as recovery", async () => {
		const first = await seed();
		const second = await seed(first);
		await verify(first, "failed");
		await verify(second, "failed");
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(1);
		await verify(first, "passed", at(1000));
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(0);
		let time = 2000;
		for (const status of ["queued", "running", "skipped"] as const) {
			await db
				.delete(tables.providerModelVerification)
				.where(
					eq(tables.providerModelVerification.draftModelId, second.draft.id),
				);
			await verify(second, status, at(time));
			expect(await deliverAirsideVerificationEmails(at(time), sender)).toBe(0);
			time += 1000;
		}
	});
	it.each([
		"paused",
		"delisted",
		"inactive",
		"unclaimed",
		"credentials",
		"declaration",
	])(
		"excludes %s listings and does not infer recovery from removal",
		async (reason) => {
			const fixture = await seed();
			await verify(fixture, "failed");
			expect(await deliverAirsideVerificationEmails(now, sender)).toBe(1);
			if (reason === "paused") {
				await db
					.update(tables.providerDraftModel)
					.set({ pausedAt: at(1000) })
					.where(eq(tables.providerDraftModel.id, fixture.draft.id));
			}
			if (reason === "delisted") {
				await db
					.update(tables.providerDraftModel)
					.set({ status: "delisted" })
					.where(eq(tables.providerDraftModel.id, fixture.draft.id));
			}
			if (reason === "inactive") {
				await db
					.update(tables.modelProviderMapping)
					.set({ status: "inactive" })
					.where(eq(tables.modelProviderMapping.id, fixture.mapping.id));
			}
			if (reason === "unclaimed") {
				await db
					.update(tables.providerClaim)
					.set({ status: "revoked" })
					.where(eq(tables.providerClaim.providerCompanyId, fixture.companyId));
			}
			if (reason === "credentials") {
				await db
					.update(tables.providerClaim)
					.set({ verificationKeyCiphertext: null })
					.where(eq(tables.providerClaim.providerCompanyId, fixture.companyId));
			}
			if (reason === "declaration") {
				await db
					.update(tables.modelProviderMapping)
					.set({ vision: true })
					.where(eq(tables.modelProviderMapping.id, fixture.mapping.id));
			}
			if (reason === "catalogue") {
				await db
					.update(tables.modelProviderMapping)
					.set({ source: "catalogue" })
					.where(eq(tables.modelProviderMapping.id, fixture.mapping.id));
			}
			expect(
				await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
			).toBe(0);
			expect(sender).toHaveBeenCalledTimes(1);
		},
	);
	it("does not consume cooldown without a sender, verified recipient, or acknowledged send", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, fixture.userId));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		await db
			.update(tables.user)
			.set({ emailVerified: true })
			.where(eq(tables.user.id, fixture.userId));
		sender.mockResolvedValueOnce(false);
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(1);
		expect(sender.mock.calls[0][0].idempotencyKey).toBe(
			sender.mock.calls[1][0].idempotencyKey,
		);
	});
	it("retries ambiguous errors with an identical envelope and key, without logging error contents", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		sender.mockRejectedValueOnce(new Error("private recipient/body/secret"));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(1);
		expect(sender.mock.calls[0][0]).toEqual(sender.mock.calls[1][0]);
		expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
			"private",
		);
	});
	it("never retries ambiguous attempts after the transport idempotency window expires", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		sender.mockRejectedValueOnce(new Error("ambiguous transport"));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(DAY_MS), sender)).toBe(0);
		expect(sender).toHaveBeenCalledTimes(1);
	});
	it("does not send to reserved addresses in production or fake success when Resend is missing", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		vi.stubEnv("NODE_ENV", "production");
		expect(await deliverAirsideVerificationEmails(now)).toBe(0);
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		expect(sender).not.toHaveBeenCalled();
	});
	it("keeps sender batch retries idempotent after partial transport acceptance", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		const accepted = new Set<string>();
		const delivered: AirsideVerificationEmail[] = [];
		const partial: AirsideVerificationEmailSender = async (email) => {
			if (!accepted.has(email.idempotencyKey)) {
				accepted.add(email.idempotencyKey);
				delivered.push(email);
				throw new Error("accepted before process crash");
			}
			return true;
		};
		expect(await deliverAirsideVerificationEmails(now, partial)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(1000), partial)).toBe(1);
		expect(delivered).toHaveLength(1);
	});
});

describe("durable email attempt retirement", () => {
	it("normalizes a large fleet and roster without oversized indexed progress keys", async () => {
		const first = await seed();
		const fleet = [first];
		for (let index = 1; index < 64; index++) {
			fleet.push(await seed(first));
		}
		for (const fixture of fleet) {
			await verify(fixture, "failed");
		}
		for (let index = 0; index < 16; index++) {
			await member(first.companyId);
		}
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(1);
		for (const fixture of fleet) {
			expect(sender.mock.calls[0][0].text).toContain(fixture.modelId);
		}
		expect(sender.mock.calls[0][0].to).toHaveLength(17);
		const rows = await db.select().from(tables.aggregationProgress);
		expect(
			Math.max(...rows.map((row) => Buffer.byteLength(row.job))),
		).toBeLessThan(1000);
	});
	it("includes currently claimed catalogue listings without a draft and excludes unclaimed catalogue", async () => {
		const fixture = await seed();
		const job = await verify(fixture, "failed");
		await db
			.update(tables.modelProviderMapping)
			.set({ source: "catalogue" })
			.where(eq(tables.modelProviderMapping.id, fixture.mapping.id));
		await db
			.update(tables.providerModelVerification)
			.set({ draftModelId: null })
			.where(eq(tables.providerModelVerification.id, job.id));
		await db
			.delete(tables.providerDraftModel)
			.where(eq(tables.providerDraftModel.id, fixture.draft.id));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(1);
		await db
			.update(tables.providerClaim)
			.set({ status: "revoked" })
			.where(eq(tables.providerClaim.providerCompanyId, fixture.companyId));
		expect(
			await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
		).toBe(0);
	});
	it("retires changed recipients, preserves ambiguous-send quota, and eventually delivers to current members", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		sender.mockRejectedValueOnce(new Error("ambiguous delivery"));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		const old = sender.mock.calls[0][0];
		await db
			.update(tables.user)
			.set({ email: "changed@example.com" })
			.where(eq(tables.user.id, fixture.userId));
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(2000), sender)).toBe(0);
		expect(
			await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
		).toBe(1);
		expect(sender.mock.calls[1][0].to).toEqual(["changed@example.com"]);
		expect(sender.mock.calls[1][0].idempotencyKey).not.toBe(old.idempotencyKey);
	});
	it("retires stale failures without orphan recovery and permits a later failure after the reserved window", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		sender.mockRejectedValueOnce(new Error("ambiguous delivery"));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		await verify(fixture, "passed", at(1000));
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(2000), sender)).toBe(0);
		await verify(fixture, "failed", at(3000));
		expect(await deliverAirsideVerificationEmails(at(3000), sender)).toBe(0);
		expect(
			await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
		).toBe(1);
		expect(
			sender.mock.calls.every(([email]) => email.subject.includes("failed")),
		).toBe(true);
	});
	it("allows new attempts after expiry without replaying the old key or marking retirement delivered", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		sender.mockRejectedValueOnce(new Error("ambiguous delivery"));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(DAY_MS), sender)).toBe(0);
		expect(
			await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
		).toBe(1);
		expect(sender.mock.calls[0][0].idempotencyKey).not.toBe(
			sender.mock.calls[1][0].idempotencyKey,
		);
	});
});
function additionalEmailTimingTests() {
	it("reserves the quota from delayed ambiguous acceptance rather than invocation time", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		const clock = vi.spyOn(Date, "now").mockReturnValue(now.getTime());
		try {
			sender.mockImplementationOnce(async () => {
				clock.mockReturnValue(at(10_000).getTime());
				throw new Error("delayed ambiguous acceptance");
			});
			expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
			await db
				.update(tables.user)
				.set({ email: "changed@example.com" })
				.where(eq(tables.user.id, fixture.userId));
			expect(await deliverAirsideVerificationEmails(at(20_000), sender)).toBe(
				0,
			);
			expect(
				await deliverAirsideVerificationEmails(at(DAY_MS + 1000), sender),
			).toBe(0);
			expect(
				await deliverAirsideVerificationEmails(at(DAY_MS + 11_000), sender),
			).toBe(1);
		} finally {
			clock.mockRestore();
		}
	});
	it("bounds hanging transport and retries the ambiguous attempt with the same key", async () => {
		const fixture = await seed();
		await verify(fixture, "failed");
		sender.mockImplementationOnce(() => new Promise<boolean>(() => {}));
		expect(await deliverAirsideVerificationEmails(now, sender)).toBe(0);
		expect(await deliverAirsideVerificationEmails(at(1000), sender)).toBe(1);
		expect(sender.mock.calls[0][0].idempotencyKey).toBe(
			sender.mock.calls[1][0].idempotencyKey,
		);
	});
	it("does not let inactive notified listings block another active listing recovery", () => {
		const removed = observed({ mappingId: "removed" });
		const active = observed({ mappingId: "active" });
		const healthy = observed({
			mappingId: "active",
			verificationId: "later-pass",
			status: "healthy",
			completedAt: at(1000),
		});
		expect(
			chooseAirsideVerificationEmail(
				[healthy],
				[removed, active],
				now,
				at(1000),
			),
		).toBe("recovery");
		expect(
			chooseAirsideVerificationEmail([], [removed], now, at(1000)),
		).toBeNull();
		expect(
			chooseAirsideVerificationEmail([healthy], [removed], now, at(1000)),
		).toBeNull();
	});
}
additionalEmailTimingTests();
