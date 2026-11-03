import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	encryptClaimVerificationKey,
	encryptProviderKeyForStorage,
	mappingTarget,
	modelVerificationEnvironmentToken,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { models as catalogueModels } from "@llmgateway/models";

import {
	dailyModelVerificationId,
	scheduleDailyModelVerifications,
	modelVerificationConcurrency,
} from "./daily-model-verifications.js";
import {
	deliverModelVerificationRegressions,
	regressedVerificationChecks,
} from "./model-verification-regressions.js";
import {
	claimNextModelVerification,
	processNextModelVerification,
} from "./model-verifications.js";

import type { ProviderModelVerificationCheck } from "@llmgateway/db";
import type { ModelDefinition } from "@llmgateway/models";

type Verification = typeof tables.providerModelVerification.$inferSelect;
const now = new Date();
const day = 24 * 60 * 60 * 1000;
const providers: string[] = [];
const models: string[] = [];
const companies: string[] = [];
const users: string[] = [];

beforeEach(async () => {
	vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "daily-verification-test-secret");
	vi.stubEnv("AIRSIDE_DAILY_VERIFICATION_ENABLED", "true");
	vi.stubEnv(
		"AIRSIDE_VERIFICATION_DISCORD_WEBHOOK_URL",
		"https://discord.example.com/webhook",
	);
	await db.delete(tables.providerModelVerification);
	await db.delete(tables.aggregationProgress);
});

afterEach(async () => {
	await db.delete(tables.providerModelVerification);
	for (const id of companies.splice(0)) {
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, id));
	}
	for (const id of providers.splice(0)) {
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.provider, id));
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

async function seed(
	source: "catalogue" | "airside" = "catalogue",
	providerId = "daily-provider-" + randomUUID(),
) {
	if (!providers.includes(providerId)) {
		providers.push(providerId);
		await db.insert(tables.provider).values({
			id: providerId,
			name: "Verification Provider",
			description: "Test provider",
		});
		const keyId = randomUUID();
		await db.insert(tables.providerKey).values({
			id: keyId,
			provider: providerId,
			managed: true,
			...encryptProviderKeyForStorage("test-provider-key", keyId, null),
		});
	}
	const modelId = "daily-model-" + randomUUID();
	models.push(modelId);
	await db.insert(tables.model).values({
		id: modelId,
		name: "Verification Model",
		family: "verification",
	});
	const [mapping] = await db
		.insert(tables.modelProviderMapping)
		.values({ modelId, providerId, externalId: modelId, source })
		.returning();
	let draftId: string | undefined;
	let claimId: string | undefined;
	if (source === "airside") {
		const companyId = randomUUID();
		const userId = randomUUID();
		companies.push(companyId);
		users.push(userId);
		await db.insert(tables.user).values({
			id: userId,
			email: userId + "@example.com",
			name: "Verification User",
		});
		await db
			.insert(tables.providerCompany)
			.values({ id: companyId, name: "Verification Company" });
		claimId = randomUUID();
		await db.insert(tables.providerClaim).values({
			id: claimId,
			providerCompanyId: companyId,
			providerId,
			kind: "custom",
			matchedDomain: "example.com",
			customBaseUrl: "https://provider.example.com",
			status: "active",
			claimedBy: userId,
			verificationKeyCiphertext: encryptClaimVerificationKey(
				"test-carrier-key",
				claimId,
				companyId,
			),
		});
		const [draft] = await db
			.insert(tables.providerDraftModel)
			.values({
				providerCompanyId: companyId,
				providerId,
				modelName: modelId,
				externalId: modelId,
				status: "active",
			})
			.returning();
		draftId = draft.id;
	}
	return {
		mapping,
		draftId,
		claimId,
		id: dailyModelVerificationId(mapping.id, now),
	};
}

async function job(id: string): Promise<Verification> {
	return (await db.query.providerModelVerification.findFirst({
		where: { id: { eq: id } },
	}))!;
}

const check = (
	status: "passed" | "failed",
): ProviderModelVerificationCheck => ({
	id: "basic",
	label: "Basic completion",
	status,
});
async function complete(id: string, status: "passed" | "failed", at = now) {
	await db
		.update(tables.providerModelVerification)
		.set({ status, checks: [check(status)], createdAt: at, completedAt: at })
		.where(eq(tables.providerModelVerification.id, id));
}
async function baseline(current: Verification, draftId?: string) {
	await db.insert(tables.providerModelVerification).values({
		id: randomUUID(),
		modelProviderMappingId: draftId ? null : current.modelProviderMappingId,
		draftModelId: draftId,
		providerCompanyId: current.providerCompanyId,
		initiatedBy: "admin",
		target: current.target,
		checks: [check("passed")],
		status: "passed",
		credentialSource: "managed",
		createdAt: new Date(now.getTime() - day),
		completedAt: new Date(now.getTime() - day),
	});
}

describe("daily model verification scheduling", () => {
	it("is opt-in and once per UTC day across replicas and completed runs", async () => {
		const fixture = await seed();
		vi.stubEnv("AIRSIDE_DAILY_VERIFICATION_ENABLED", "false");
		expect(await scheduleDailyModelVerifications(now)).toBe(0);
		vi.stubEnv("AIRSIDE_DAILY_VERIFICATION_ENABLED", "true");
		expect(
			(
				await Promise.all([
					scheduleDailyModelVerifications(now),
					scheduleDailyModelVerifications(now),
				])
			).reduce((a, b) => a + b, 0),
		).toBe(1);
		expect(
			await scheduleDailyModelVerifications(new Date(now.getTime() + day)),
		).toBe(0);
		await complete(fixture.id, "passed");
		expect(await scheduleDailyModelVerifications(now)).toBe(0);
		expect(
			await scheduleDailyModelVerifications(new Date(now.getTime() + day)),
		).toBe(1);
	});

	it.each([
		"mapping",
		"model",
		"provider",
		"deactivated",
		"non-text",
		"missing-key",
		"model-restriction",
	])("ignores %s ineligible catalogue mappings", async (kind) => {
		const { mapping } = await seed();
		if (kind === "mapping") {
			await db
				.update(tables.modelProviderMapping)
				.set({ status: "inactive" })
				.where(eq(tables.modelProviderMapping.id, mapping.id));
		}
		if (kind === "model") {
			await db
				.update(tables.model)
				.set({ status: "inactive" })
				.where(eq(tables.model.id, mapping.modelId));
		}
		if (kind === "provider") {
			await db
				.update(tables.provider)
				.set({ status: "inactive" })
				.where(eq(tables.provider.id, mapping.providerId));
		}
		if (kind === "deactivated") {
			await db
				.update(tables.modelProviderMapping)
				.set({ deactivatedAt: new Date(now.getTime() - 1) })
				.where(eq(tables.modelProviderMapping.id, mapping.id));
		}
		if (kind === "non-text") {
			await db
				.update(tables.model)
				.set({ output: ["image"] })
				.where(eq(tables.model.id, mapping.modelId));
		}
		if (kind === "missing-key") {
			await db
				.delete(tables.providerKey)
				.where(eq(tables.providerKey.provider, mapping.providerId));
		}
		if (kind === "model-restriction") {
			await db
				.update(tables.providerKey)
				.set({ allowedModels: ["another-model"] })
				.where(eq(tables.providerKey.provider, mapping.providerId));
		}
		expect(await scheduleDailyModelVerifications(now)).toBe(0);
	});

	it.each(["paused", "delisted", "draft", "revoked", "missing-test-key"])(
		"ignores %s Airside listings without falling back to managed serving keys",
		async (kind) => {
			const { draftId, claimId } = await seed("airside");
			if (kind === "paused") {
				await db
					.update(tables.providerDraftModel)
					.set({ pausedAt: now })
					.where(eq(tables.providerDraftModel.id, draftId!));
			}
			if (kind === "delisted" || kind === "draft") {
				await db
					.update(tables.providerDraftModel)
					.set({ status: kind })
					.where(eq(tables.providerDraftModel.id, draftId!));
			}
			if (kind === "revoked") {
				await db
					.update(tables.providerClaim)
					.set({ status: "revoked" })
					.where(eq(tables.providerClaim.id, claimId!));
			}
			if (kind === "missing-test-key") {
				await db
					.update(tables.providerClaim)
					.set({ verificationKeyCiphertext: null })
					.where(eq(tables.providerClaim.id, claimId!));
			}
			expect(await scheduleDailyModelVerifications(now)).toBe(0);
		},
	);

	it("covers regional mappings and typed decisions without promoting optional warnings", async () => {
		const { mapping } = await seed();
		await db
			.update(tables.modelProviderMapping)
			.set({ region: "test-region", decisions: true })
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		expect(await scheduleDailyModelVerifications(now)).toBe(1);
		const queued = await job(dailyModelVerificationId(mapping.id, now));
		expect(queued.target.region).toBe("test-region");
		expect(queued.target.decisions).toBe(true);
		expect(
			queued.checks.every((c) => !["streaming", "tools"].includes(c.id)),
		).toBe(true);
	});

	it("uses current carrier credentials after rotation, not erased history ciphertext", async () => {
		const { id, claimId } = await seed("airside");
		expect(await scheduleDailyModelVerifications(now)).toBe(1);
		const queued = await job(id);
		expect(queued.credentialCiphertext).toBeNull();
		const claim = (await db.query.providerClaim.findFirst({
			where: { id: { eq: claimId! } },
		}))!;
		await db
			.update(tables.providerClaim)
			.set({
				verificationKeyCiphertext: encryptClaimVerificationKey(
					"rotated-test-key",
					claim.id,
					claim.providerCompanyId,
				),
			})
			.where(eq(tables.providerClaim.id, claim.id));
		const runner = vi.fn(async (options) => {
			expect(options.token === "rotated-test-key").toBe(true);
			expect(options.baseUrl).toBe("https://provider.example.com");
			return { passed: true, summary: "Passed", checks: [check("passed")] };
		});
		await processNextModelVerification(runner);
		expect(runner).toHaveBeenCalledTimes(1);
		expect((await job(id)).credentialCiphertext).toBeNull();
	});

	it.each(["inactive", "credential-removed", "changed"])(
		"rechecks %s before execution without bogus failed checks",
		async (kind) => {
			const { id, mapping } = await seed();
			await scheduleDailyModelVerifications(now);
			if (kind === "inactive") {
				await db
					.update(tables.modelProviderMapping)
					.set({ status: "inactive" })
					.where(eq(tables.modelProviderMapping.id, mapping.id));
			}
			if (kind === "credential-removed") {
				await db
					.delete(tables.providerKey)
					.where(eq(tables.providerKey.provider, mapping.providerId));
			}
			if (kind === "changed") {
				await db
					.update(tables.modelProviderMapping)
					.set({ streaming: true })
					.where(eq(tables.modelProviderMapping.id, mapping.id));
			}
			const runner = vi.fn();
			await processNextModelVerification(runner);
			expect(runner).not.toHaveBeenCalled();
			expect((await job(id)).checks.every((c) => c.status === "skipped")).toBe(
				true,
			);
		},
	);

	it("prioritizes manual runs and serializes scheduled work per provider", async () => {
		const first = await seed();
		await seed("catalogue", first.mapping.providerId);
		const other = await seed();
		await scheduleDailyModelVerifications(now);
		const scheduled = await job(first.id);
		await db.insert(tables.providerModelVerification).values({
			id: "manual-" + randomUUID(),
			initiatedBy: "admin",
			target: scheduled.target,
			checks: scheduled.checks,
			credentialSource: "managed",
		});
		expect((await claimNextModelVerification())?.id.startsWith("manual-")).toBe(
			true,
		);
		expect((await claimNextModelVerification())?.id).toBe(other.id);
		expect(await claimNextModelVerification()).toBeNull();
	});
});

describe("verification regression delivery", () => {
	it("delivers once across replicas, omits secrets and feedback, and disables mentions", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		await baseline(await job(id));
		await complete(id, "failed");
		const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
			const payload = JSON.parse(String(options?.body));
			expect(payload.allowed_mentions).toEqual({ parse: [] });
			expect(payload.embeds[0].fields[1].value).toBe("basic");
			expect(String(options?.body).includes("test-provider-key")).toBe(false);
			expect(options?.signal).toBeInstanceOf(AbortSignal);
			return new Response(null, { status: 204 });
		});
		expect(
			(
				await Promise.all([
					deliverModelVerificationRegressions(now, fetcher),
					deliverModelVerificationRegressions(now, fetcher),
				])
			).reduce((a, b) => a + b, 0),
		).toBe(1);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(await deliverModelVerificationRegressions(now, fetcher)).toBe(0);
	});

	it("retries rate limits durably and honours Retry-After", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		await baseline(await job(id));
		await complete(id, "failed");
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(null, { status: 429, headers: { "Retry-After": "600" } }),
			)
			.mockResolvedValue(new Response(null, { status: 204 }));
		expect(await deliverModelVerificationRegressions(now, fetcher)).toBe(0);
		expect(
			await deliverModelVerificationRegressions(minutesAfterNow(6), fetcher),
		).toBe(0);
		expect(
			await deliverModelVerificationRegressions(minutesAfterNow(11), fetcher),
		).toBe(1);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it.each(["inactive", "credential-removed", "first-failure", "disabled"])(
		"does not alert for %s",
		async (kind) => {
			const { id, mapping } = await seed();
			await scheduleDailyModelVerifications(now);
			if (kind !== "first-failure") {
				await baseline(await job(id));
			}
			await complete(id, "failed");
			if (kind === "inactive") {
				await db
					.update(tables.modelProviderMapping)
					.set({ status: "inactive" })
					.where(eq(tables.modelProviderMapping.id, mapping.id));
			}
			if (kind === "credential-removed") {
				await db
					.delete(tables.providerKey)
					.where(eq(tables.providerKey.provider, mapping.providerId));
			}
			if (kind === "disabled") {
				vi.stubEnv("AIRSIDE_VERIFICATION_DISCORD_WEBHOOK_URL", "");
			}
			const fetcher = vi.fn<typeof fetch>();
			expect(await deliverModelVerificationRegressions(now, fetcher)).toBe(0);
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it("reuses carrier-initiated listing history", async () => {
		const { id, draftId } = await seed("airside");
		await scheduleDailyModelVerifications(now);
		await baseline(await job(id), draftId);
		await complete(id, "failed");
		expect(
			await deliverModelVerificationRegressions(
				now,
				vi
					.fn<typeof fetch>()
					.mockResolvedValue(new Response(null, { status: 204 })),
			),
		).toBe(1);
	});

	it("suppresses persistent failures and re-arms after recovery", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		const current = { ...(await job(id)), checks: [check("failed")] };
		const passed = { ...current, checks: [check("passed")] };
		expect(regressedVerificationChecks(current, [passed])).toEqual(["basic"]);
		expect(regressedVerificationChecks(current, [current, passed])).toEqual([]);
		expect(
			regressedVerificationChecks(current, [passed, current, passed]),
		).toEqual(["basic"]);
		expect(
			regressedVerificationChecks(
				{
					...current,
					checks: [{ ...check("passed"), optionalWarnings: ["warning"] }],
				},
				[passed],
			),
		).toEqual([]);
	});

	it("detects previously successful probes even when the parent check passes", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		const base = await job(id);
		const current = {
			...base,
			target: { ...base.target, tools: true },
			checks: [
				{
					id: "tools",
					label: "Tools",
					status: "passed" as const,
					probes: [
						{ label: "tool_choice: required", status: "failed" as const },
					],
				},
			],
		};
		const previous = {
			...current,
			checks: [
				{
					...current.checks[0],
					probes: [
						{ label: "tool_choice: required", status: "passed" as const },
					],
				},
			],
		};
		expect(regressedVerificationChecks(current, [previous])).toEqual(["tools"]);
		expect(regressedVerificationChecks(current, [current, previous])).toEqual(
			[],
		);
	});
});
function additionalDailyTests() {
	it("honours UTC date boundaries", () => {
		expect(
			dailyModelVerificationId("mapping", new Date("2026-01-01T23:59:59Z")),
		).not.toBe(
			dailyModelVerificationId("mapping", new Date("2026-01-02T00:00:00Z")),
		);
	});
	it("does not narrow capabilities on daily Airside runs and links existing history", async () => {
		const { id, draftId, mapping } = await seed("airside");
		await db
			.update(tables.modelProviderMapping)
			.set({
				tools: true,
				reasoning: true,
				supportedToolChoices: ["auto", "required"],
				reasoningEfforts: ["low", "high"],
			})
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		await db
			.update(tables.providerDraftModel)
			.set({
				tools: true,
				reasoning: true,
				supportedToolChoices: ["auto", "required"],
				reasoningEfforts: ["low", "high"],
			})
			.where(eq(tables.providerDraftModel.id, draftId!));
		await scheduleDailyModelVerifications(now);
		expect((await job(id)).draftModelId).toBe(draftId);
		await processNextModelVerification(async () => ({
			passed: true,
			checks: [check("passed")],
			summary: "Passed",
			unsupportedToolChoices: ["required"],
			unsupportedReasoningEfforts: ["high"],
		}));
		const draft = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: draftId! } },
		});
		expect(draft?.supportedToolChoices).toEqual(["auto", "required"]);
		expect(draft?.reasoningEfforts).toEqual(["low", "high"]);
	});
	it("uses source-specific declaration metadata when a static mapping also exists", async () => {
		const definition = (catalogueModels as readonly ModelDefinition[]).find(
			(model) =>
				model.providers.some((provider) => provider.reasoningEfforts?.length),
		);
		expect(definition).toBeDefined();
		const provider = definition!.providers.find(
			(candidate) => candidate.reasoningEfforts?.length,
		)!;
		const { mapping } = await seed("catalogue", provider.providerId);
		models.push(definition!.id);
		await db
			.insert(tables.model)
			.values({ id: definition!.id, family: "verification" });
		const [row] = await db
			.update(tables.modelProviderMapping)
			.set({
				modelId: definition!.id,
				source: "airside",
				reasoningEfforts: ["low"],
				supportedToolChoices: ["auto"],
				webSearchFormat: "web_search_tool",
			})
			.where(eq(tables.modelProviderMapping.id, mapping.id))
			.returning();
		expect(mappingTarget(row).reasoningEfforts).toEqual(["low"]);
		expect(mappingTarget(row).supportedToolChoices).toEqual(["auto"]);
		expect(mappingTarget(row).webSearchFormat).toBe("web_search_tool");
		expect(
			mappingTarget({ ...row, source: "catalogue" }).reasoningEfforts,
		).toEqual(provider.reasoningEfforts);
	});
	it("discovers static decision metadata when sync left the row flag false", async () => {
		const definition = (catalogueModels as readonly ModelDefinition[]).find(
			(model) => model.providers.some((provider) => provider.decisions),
		);
		const provider = definition!.providers.find(
			(candidate) => candidate.decisions,
		)!;
		const { mapping, id } = await seed("catalogue", provider.providerId);
		models.push(definition!.id);
		await db.insert(tables.model).values({
			id: definition!.id,
			family: "verification",
			output: ["decision"],
		});
		await db
			.update(tables.modelProviderMapping)
			.set({
				modelId: definition!.id,
				externalId: provider.externalId,
				decisions: false,
			})
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		expect(await scheduleDailyModelVerifications(now)).toBe(1);
		expect((await job(id)).target.decisions).toBe(true);
	});
	it("drops a pending alert if the declaration changed after the run", async () => {
		const { id, mapping } = await seed();
		await scheduleDailyModelVerifications(now);
		await baseline(await job(id));
		await complete(id, "failed");
		await db
			.update(tables.modelProviderMapping)
			.set({ streaming: true })
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		const fetcher = vi.fn<typeof fetch>();
		expect(await deliverModelVerificationRegressions(now, fetcher)).toBe(0);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("keeps equal-timestamp history rows across page boundaries", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		const current = await job(id);
		await complete(id, "failed");
		const timestamp = new Date(now.getTime() - day);
		await db.insert(tables.providerModelVerification).values(
			Array.from({ length: 105 }, (_, index) => ({
				id: "history-" + String(index).padStart(3, "0"),
				modelProviderMappingId: current.modelProviderMappingId,
				target: current.target,
				checks: [
					{
						...check("passed"),
						status: index === 0 ? ("passed" as const) : ("skipped" as const),
					},
				],
				status: "passed" as const,
				credentialSource: "managed" as const,
				createdAt: timestamp,
				completedAt: timestamp,
			})),
		);
		expect(
			await deliverModelVerificationRegressions(
				now,
				vi
					.fn<typeof fetch>()
					.mockResolvedValue(new Response(null, { status: 204 })),
			),
		).toBe(1);
	});
	it("retries network failures without changing failed verification history", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		await baseline(await job(id));
		await complete(id, "failed");
		const fetcher = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error("network unavailable"))
			.mockResolvedValue(new Response(null, { status: 204 }));
		expect(await deliverModelVerificationRegressions(now, fetcher)).toBe(0);
		expect((await job(id)).status).toBe("failed");
		expect(
			await deliverModelVerificationRegressions(minutesAfterNow(6), fetcher),
		).toBe(1);
	});
	it("bounds consumer concurrency", () => {
		for (const value of ["", "0", "17", "2.5", "invalid"]) {
			vi.stubEnv("MODEL_VERIFICATION_CONCURRENCY", value);
			expect(modelVerificationConcurrency()).toBe(4);
		}
		vi.stubEnv("MODEL_VERIFICATION_CONCURRENCY", "8");
		expect(modelVerificationConcurrency()).toBe(8);
	});
	it("claims different providers concurrently without duplicating jobs", async () => {
		const first = await seed();
		await seed("catalogue", first.mapping.providerId);
		await seed();
		await scheduleDailyModelVerifications(now);
		const claims = await Promise.all([
			claimNextModelVerification(),
			claimNextModelVerification(),
			claimNextModelVerification(),
			claimNextModelVerification(),
		]);
		const claimed = claims.filter(
			(value): value is Verification => value !== null,
		);
		expect(claimed).toHaveLength(2);
		expect(new Set(claimed.map((value) => value.target.providerId)).size).toBe(
			2,
		);
	});
	it("keeps attempted delivery retries beyond the initial discovery window", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		await baseline(await job(id));
		await complete(id, "failed", daysAfterNow(-6));
		await db
			.update(tables.providerModelVerification)
			.set({ createdAt: daysAfterNow(-8) })
			.where(eq(tables.providerModelVerification.status, "passed"));
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 429,
					headers: { "Retry-After": "172800" },
				}),
			)
			.mockResolvedValue(new Response(null, { status: 204 }));
		expect(await deliverModelVerificationRegressions(now, fetcher)).toBe(0);
		expect(
			await deliverModelVerificationRegressions(daysAfterNow(3), fetcher),
		).toBe(1);
	});
	it("does not schedule a mapping on a managed key pinned to another region", async () => {
		const { mapping } = await seed();
		await db
			.update(tables.modelProviderMapping)
			.set({ region: "wanted-region" })
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		await db
			.update(tables.providerKey)
			.set({ region: "other-region" })
			.where(eq(tables.providerKey.provider, mapping.providerId));
		expect(await scheduleDailyModelVerifications(now)).toBe(0);
	});
	it("prefers a managed credential pinned to the mapping region", async () => {
		const { mapping, id } = await seed();
		await db
			.update(tables.modelProviderMapping)
			.set({ region: "wanted-region" })
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		const keyId = randomUUID();
		await db.insert(tables.providerKey).values({
			id: keyId,
			provider: mapping.providerId,
			managed: true,
			region: "wanted-region",
			...encryptProviderKeyForStorage("regional-test-key", keyId, null),
		});
		expect(await scheduleDailyModelVerifications(now)).toBe(1);
		const runner = vi.fn(async (options) => {
			expect(options.token === "regional-test-key").toBe(true);
			return { passed: true, checks: [check("passed")], summary: "Passed" };
		});
		await processNextModelVerification(runner);
		expect(runner).toHaveBeenCalledOnce();
		expect((await job(id)).status).toBe("passed");
	});
	it("schedules and executes a regional-only environment credential", async () => {
		vi.stubEnv("LLM_ALIBABA_API_KEY", "");
		vi.stubEnv("LLM_ALIBABA_API_KEY__US_VIRGINIA", "regional-env-test-key");
		const { mapping, id } = await seed("catalogue", "alibaba");
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.provider, mapping.providerId));
		await db
			.update(tables.modelProviderMapping)
			.set({ region: "us-virginia" })
			.where(eq(tables.modelProviderMapping.id, mapping.id));
		expect(await scheduleDailyModelVerifications(now)).toBe(1);
		expect((await job(id)).credentialSource).toBe("environment");
		const runner = vi.fn(async (options) => {
			expect(options.token === "regional-env-test-key").toBe(true);
			return { passed: true, checks: [check("passed")], summary: "Passed" };
		});
		await processNextModelVerification(runner);
		expect(runner).toHaveBeenCalledOnce();
	});
	it("preserves JSON environment credentials and selects plain token lists", async () => {
		const { id } = await seed();
		await scheduleDailyModelVerifications(now);
		const target = {
			...(await job(id)).target,
			providerId: "alibaba",
			region: "us-virginia",
		};
		const json = JSON.stringify({
			type: "service_account",
			project_id: "test-project",
		});
		vi.stubEnv("LLM_ALIBABA_API_KEY__US_VIRGINIA", json);
		expect(modelVerificationEnvironmentToken(target) === json).toBe(true);
		vi.stubEnv(
			"LLM_ALIBABA_API_KEY__US_VIRGINIA",
			"first-test-key,second-test-key",
		);
		expect(modelVerificationEnvironmentToken(target) === "first-test-key").toBe(
			true,
		);
		vi.stubEnv("LLM_ALIBABA_API_KEY__SINGAPORE", json);
		expect(
			modelVerificationEnvironmentToken({ ...target, region: null }) === json,
		).toBe(true);
	});
	it("keeps manual work eligible when its provider already has a running daily job", async () => {
		const first = await seed();
		await seed("catalogue", first.mapping.providerId);
		await scheduleDailyModelVerifications(now);
		expect(await claimNextModelVerification()).not.toBeNull();
		const queued = await job(first.id);
		const manualId = "manual-" + randomUUID();
		await db.insert(tables.providerModelVerification).values({
			id: manualId,
			initiatedBy: "admin",
			target: queued.target,
			checks: queued.checks,
			credentialSource: "managed",
		});
		expect((await claimNextModelVerification())?.id).toBe(manualId);
		expect(await claimNextModelVerification()).toBeNull();
	});
}
additionalDailyTests();
function minutesAfterNow(minutes: number): Date {
	const delay = minutes * 60_000;
	return new Date(now.getTime() + delay);
}
function daysAfterNow(days: number): Date {
	const delay = days * day;
	return new Date(now.getTime() + delay);
}
