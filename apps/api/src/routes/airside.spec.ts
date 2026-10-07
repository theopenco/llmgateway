import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as emailUtils from "@/utils/email.js";

import {
	encryptProviderKeyForStorage,
	readProviderKey,
} from "@llmgateway/actions";
import {
	db,
	eq,
	getEffectiveDiscount,
	inArray,
	sql,
	tables,
} from "@llmgateway/db";
import {
	models as catalogueModels,
	REASONING_EFFORTS,
	type ModelDefinition,
	type ProviderApiFormat,
	type ToolChoiceMode,
} from "@llmgateway/models";

// Website verification resolves a real TXT record; the zone under test is
// this map. An unlisted name behaves like NXDOMAIN, which is what an
// unpublished record looks like to the resolver.
const txtRecords = new Map<string, string[][]>();

vi.mock("node:dns/promises", () => ({
	lookup: async (hostname: string) => {
		throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
			code: "ENOTFOUND",
		});
	},
	Resolver: class {
		async resolveTxt(name: string) {
			const found = txtRecords.get(name);
			if (!found) {
				throw Object.assign(new Error("queryTxt ENOTFOUND"), {
					code: "ENOTFOUND",
				});
			}
			return found;
		}
	},
}));

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const originalListingPriceId = process.env.AIRSIDE_LISTING_PRICE_ID;

async function setUserEmail(email: string) {
	await db
		.update(tables.user)
		.set({ email })
		.where(eq(tables.user.id, "test-user-id"));
}

const carrierProfile = {
	website: "https://acme-sky.ai",
	privacyPolicyUrl: "https://acme-sky.ai/privacy",
	termsUrl: "https://acme-sky.ai/terms",
};

function json(cookie: string, body?: unknown, method = "POST") {
	return {
		method,
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	};
}

async function createCompany(cookie: string, name = "Mistral Ops") {
	const res = await app.request(
		"/airside/companies",
		json(cookie, { name, website: "https://mistral.ai", acceptTerms: true }),
	);
	expect(res.status).toBe(201);
	const body = await res.json();
	return body.company as { id: string };
}

async function claimProvider(
	cookie: string,
	providerCompanyId: string,
	providerId = "mistral",
) {
	const res = await app.request(
		"/airside/claims",
		json(cookie, { providerCompanyId, providerId }),
	);
	expect(res.status).toBe(201);
	return (await res.json()).claim as {
		id: string;
		providerId: string;
		status: string;
	};
}

// A passed preflight proving anything the model could claim, for tests that
// edit or relist a listing but aren't about the preflight gate itself.
async function passPreflight(modelId: string) {
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: modelId } },
	});
	await db.insert(tables.providerModelVerification).values({
		id: `verification-${crypto.randomUUID()}`,
		providerCompanyId: model!.providerCompanyId,
		draftModelId: modelId,
		requestedBy: "test-user-id",
		target: {
			providerId: model!.providerId,
			modelName: model!.modelName,
			externalId: model!.externalId,
			apiFormat: model!.apiFormat ?? "openai-chat-completions",
			streaming: true,
			vision: true,
			audio: true,
			tools: true,
			supportedToolChoices: null,
			jsonOutput: true,
			jsonOutputSchema: true,
			reasoning: true,
			reasoningMaxTokens: true,
			reasoningEfforts: [...REASONING_EFFORTS],
			webSearch: true,
			contextSize: 100_000_000,
			maxOutput: 100_000_000,
		},
		checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
		status: "passed",
		completedAt: new Date(),
	});
}

// Fast-path activation for tests that aren't about the review flow itself —
// the admin approval endpoints get their own lifecycle test below.
async function activateClaim(providerId = "mistral") {
	await db
		.update(tables.providerClaim)
		.set({ status: "active" })
		.where(eq(tables.providerClaim.providerId, providerId));
}

// Fast-path for tests that aren't about the fare-change approval flow itself.
async function setRoutingSettings(
	providerCompanyId: string,
	providerId: string,
	discountPercent: number,
	marginPercent: number,
) {
	await db
		.insert(tables.providerRoutingSettings)
		.values({
			providerCompanyId,
			providerId,
			discountPercent: String(discountPercent),
			marginPercent: String(marginPercent),
		})
		.onConflictDoUpdate({
			target: tables.providerRoutingSettings.providerId,
			targetWhere: sql`model_id IS NULL`,
			set: {
				providerCompanyId,
				discountPercent: String(discountPercent),
				marginPercent: String(marginPercent),
			},
		});
}

// A second account sharing the fixture password, for crew/membership tests.
async function createSecondUser(email: string) {
	const id = `crew-${email.replace(/[^a-z0-9]/gi, "-")}`;
	await db.insert(tables.user).values({
		id,
		name: "Crew Member",
		email,
		emailVerified: true,
	});
	await db.insert(tables.account).values({
		id: `${id}-account`,
		providerId: "credential",
		accountId: `${id}-account`,
		userId: id,
		password:
			"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
	});
	const auth = await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: "admin@example.com1A" }),
	});
	expect(auth.status).toBe(200);
	return auth.headers.get("set-cookie")!;
}

async function createModel(
	cookie: string,
	providerCompanyId: string,
	overrides: Record<string, unknown> = {},
) {
	const body: Record<string, unknown> = {
		providerCompanyId,
		providerId: "mistral",
		modelName: "mistral-large-3",
		displayName: "Mistral Large 3",
		family: "mistral",
		contextSize: 256000,
		streaming: true,
		tools: true,
		pricing: { inputPrice: "2e-6", outputPrice: "6e-6" },
		...overrides,
	};
	const verificationId = `verification-${crypto.randomUUID()}`;
	await db.insert(tables.providerModelVerification).values({
		id: verificationId,
		providerCompanyId,
		requestedBy: "test-user-id",
		target: {
			providerId: String(body.providerId),
			modelName: String(body.modelName),
			externalId: String(body.externalId ?? body.modelName),
			apiFormat:
				typeof body.apiFormat === "string"
					? (body.apiFormat as ProviderApiFormat)
					: "openai-chat-completions",
			streaming: body.streaming !== false,
			vision: body.vision === true,
			audio: body.audio === true,
			tools: body.tools === true,
			supportedToolChoices: Array.isArray(body.supportedToolChoices)
				? (body.supportedToolChoices as ToolChoiceMode[])
				: null,
			jsonOutput: body.jsonOutput === true,
			jsonOutputSchema: body.jsonOutputSchema === true,
			reasoning: body.reasoning === true,
			reasoningMaxTokens: body.reasoningMaxTokens === true,
			reasoningEfforts: Array.isArray(body.reasoningEfforts)
				? body.reasoningEfforts.filter(
						(effort): effort is string => typeof effort === "string",
					)
				: null,
			webSearch: body.webSearch === true,
			contextSize:
				typeof body.contextSize === "number" ? body.contextSize : null,
			maxOutput: typeof body.maxOutput === "number" ? body.maxOutput : null,
		},
		checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
		status: "passed",
		completedAt: new Date(),
	});
	const res = await app.request(
		"/airside/models",
		json(cookie, {
			...body,
			verificationId,
		}),
	);
	return res;
}

describe("airside provider portal", () => {
	let cookie: string;

	it("offers canonical identities without flattening tiered or retired rates", async () => {
		const response = await app.request(
			"/airside/catalogue",
			json(cookie, undefined, "GET"),
		);
		expect(response.status).toBe(200);
		const data = (await response.json()) as {
			models: Array<{
				id: string;
				family: string;
				prices: Array<{
					providerId: string;
					inputPrice: string;
					outputPrice: string;
				}>;
			}>;
		};
		const oss = data.models.find((model) => model.id === "gpt-oss-20b");
		expect(oss?.family).toBe("openai");
		expect(oss?.prices).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					providerId: "groq",
					inputPrice: "0.1e-6",
					outputPrice: "0.5e-6",
				}),
			]),
		);
		expect(oss?.prices.some((price) => price.providerId === "nanogpt")).toBe(
			false,
		);
		const tiered = data.models.find((model) => model.id === "gemini-2.5-pro");
		expect(
			tiered?.prices.some((price) => price.providerId === "google-ai-studio"),
		).toBe(false);
	});

	beforeEach(async () => {
		vi.spyOn(emailUtils, "sendTransactionalEmail").mockResolvedValue(undefined);
		cookie = await createTestUser();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		if (originalListingPriceId === undefined) {
			delete process.env.AIRSIDE_LISTING_PRICE_ID;
		} else {
			process.env.AIRSIDE_LISTING_PRICE_ID = originalListingPriceId;
		}
		// Only remove catalogue rows this spec materialized. Mapping source is
		// the ownership marker; family remains the model's real taxonomy.
		const airsideMappings = await db.query.modelProviderMapping.findMany({
			where: { source: { eq: "airside" } },
			columns: { modelId: true },
		});
		if (airsideMappings.length > 0) {
			const ids = [
				...new Set(airsideMappings.map((mapping) => mapping.modelId)),
			];
			await db
				.delete(tables.modelProviderMapping)
				.where(eq(tables.modelProviderMapping.source, "airside"));
			for (const id of ids) {
				const remaining = await db.query.modelProviderMapping.findFirst({
					where: { modelId: { eq: id } },
					columns: { id: true },
				});
				if (!remaining) {
					await db.delete(tables.model).where(eq(tables.model.id, id));
				}
			}
		}
		await db
			.delete(tables.provider)
			.where(inArray(tables.provider.id, ["mistral", "acme-sky"]));
		await deleteAll();
	});

	it("rejects unauthenticated requests", async () => {
		expect((await app.request("/airside/companies")).status).toBe(401);
	});

	it("creates and lists provider companies", async () => {
		const company = await createCompany(cookie);
		const res = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.companies).toHaveLength(1);
		expect(body.companies[0]).toMatchObject({
			id: company.id,
			name: "Mistral Ops",
			role: "owner",
			claims: [],
		});
	});

	it("requires accepting the Airside terms to create a company", async () => {
		for (const acceptTerms of [undefined, false]) {
			const res = await app.request(
				"/airside/companies",
				json(cookie, { name: "No Terms Inc", acceptTerms }),
			);
			expect(res.status).toBe(400);
		}
		const created = await app.request(
			"/airside/companies",
			json(cookie, { name: "Terms Inc", acceptTerms: true }),
		);
		expect(created.status).toBe(201);
		const { company } = await created.json();
		expect(company.termsAcceptedAt).toEqual(expect.any(String));
		const row = await db.query.providerCompany.findFirst({
			where: { id: { eq: company.id } },
		});
		expect(row?.termsAcceptedBy).toBe("test-user-id");
	});

	it("records terms acceptance for an existing company", async () => {
		const company = await createCompany(cookie);
		await db
			.update(tables.providerCompany)
			.set({ termsAcceptedAt: null, termsAcceptedBy: null })
			.where(eq(tables.providerCompany.id, company.id));
		const list = async () =>
			(
				await (
					await app.request("/airside/companies", {
						headers: { Cookie: cookie },
					})
				).json()
			).companies[0];
		expect((await list()).termsAcceptedAt).toBeNull();

		const other = await createSecondUser("outsider@example.com");
		const foreign = await app.request(
			`/airside/companies/${company.id}/accept-terms`,
			json(other),
		);
		expect(foreign.status).toBe(404);

		const accepted = await app.request(
			`/airside/companies/${company.id}/accept-terms`,
			json(cookie),
		);
		expect(accepted.status).toBe(200);
		const { termsAcceptedAt } = await accepted.json();
		expect((await list()).termsAcceptedAt).toBe(termsAcceptedAt);

		await db.insert(tables.providerCompanyMember).values({
			providerCompanyId: company.id,
			userId: "crew-outsider-example-com",
			role: "member",
		});
		const repeat = await app.request(
			`/airside/companies/${company.id}/accept-terms`,
			json(other),
		);
		expect(repeat.status).toBe(200);
		expect((await repeat.json()).termsAcceptedAt).toBe(termsAcceptedAt);
		const row = await db.query.providerCompany.findFirst({
			where: { id: { eq: company.id } },
		});
		expect(row?.termsAcceptedAt?.toISOString()).toBe(termsAcceptedAt);
		expect(row?.termsAcceptedBy).toBe("test-user-id");
	});

	it("fills catalogue claim profiles from the catalogue", async () => {
		await setUserEmail("ops@mistral.ai");
		const claimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		const mistral = (await claimable.json()).providers.find(
			(p: { providerId: string }) => p.providerId === "mistral",
		);
		expect(mistral.profileDefaults).toEqual(
			expect.objectContaining({
				website: expect.any(String),
				privacyPolicyUrl: expect.any(String),
				termsUrl: expect.any(String),
			}),
		);
		expect(mistral.profileDefaults).toHaveProperty("statusPageUrl");

		const company = await createCompany(cookie);
		const res = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				profile: { statusPageUrl: "https://status.mistral.ai" },
			}),
		);
		expect(res.status).toBe(201);
		const { claim } = await res.json();
		expect(claim.profileMissing).toEqual([]);
		expect(claim.profile).toMatchObject({
			website: mistral.profileDefaults.website,
			termsUrl: mistral.profileDefaults.termsUrl,
			statusPageUrl: "https://status.mistral.ai",
		});
	});

	it("keeps cleared catalogue links cleared and the reviewed data policy", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const created = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(created.status).toBe(201);
		const { claim } = await created.json();
		const reviewed = claim.profile;
		expect(reviewed).toMatchObject({
			website: "https://mistral.ai",
			statusPageUrl: "https://status.mistral.ai",
			legalEntity: "Mistral AI",
			headquarters: "FR",
		});
		for (const key of claim.profileRecommendedMissing) {
			expect(["statusPageUrl", "legalEntity", "headquarters"]).toContain(key);
		}
		const patch = async (body: Record<string, unknown>) =>
			await app.request(
				`/airside/claims/${claim.id}/profile`,
				json(cookie, body, "PATCH"),
			);

		expect((await patch({ apiTraining: false })).status).toBe(400);
		expect((await patch({ retentionPeriod: null })).status).toBe(400);

		const cleared = await patch({
			statusPageUrl: null,
			legalEntity: "Mistral AI SAS",
		});
		expect(cleared.status).toBe(200);
		const saved = (await cleared.json()).claim;
		expect(saved.profile).toEqual({
			...reviewed,
			statusPageUrl: null,
			legalEntity: "Mistral AI SAS",
		});
		expect(saved.profileRecommendedMissing).toContain("statusPageUrl");

		const listedCompany = (
			await (
				await app.request("/airside/companies", {
					headers: { Cookie: cookie },
				})
			).json()
		).companies[0];
		expect(listedCompany.claims[0].profile.statusPageUrl).toBeNull();

		await activateClaim();
		await db
			.insert(tables.provider)
			.values({ id: "mistral", name: "Mistral", description: "" })
			.onConflictDoNothing();
		const listed = (
			await (await app.request("/internal/providers")).json()
		).providers.find((p: { id: string }) => p.id === "mistral");
		expect(listed.airsideProfile).toEqual({
			website: reviewed.website,
			statusPageUrl: null,
			termsUrl: reviewed.termsUrl,
			privacyPolicyUrl: reviewed.privacyPolicyUrl,
			legalEntity: "Mistral AI SAS",
			headquarters: "FR",
			dataPolicy: null,
		});
	});

	it("rejects listings whose model id is not catalogue-style", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const listed = await createModel(cookie, company.id, {
			modelName: "deepseek/DeepSeek V4.1 Flash",
		});
		expect(listed.status).toBe(400);
		expect((await listed.json()).message).toContain("deepseek-v4.1-flash");

		const queued = await app.request(
			"/airside/model-verifications",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				modelName: "Mistral Large 3",
			}),
		);
		expect(queued.status).toBe(400);
		expect((await queued.json()).message).toContain("mistral-large-3");
	});

	it("requires a verified email for company creation", async () => {
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, "test-user-id"));
		const res = await app.request(
			"/airside/companies",
			json(cookie, { name: "Unverified Inc", acceptTerms: true }),
		);
		expect(res.status).toBe(403);
	});

	it("lists claimable providers matched by email domain", async () => {
		// admin@example.com matches no catalogue provider.
		const none = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await none.json()).providers).toEqual([]);

		await setUserEmail("ops@mistral.ai");
		const res = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		const body = await res.json();
		expect(body.emailDomain).toBe("mistral.ai");
		expect(body.providers).toEqual([
			expect.objectContaining({
				providerId: "mistral",
				claimed: false,
				claimedByMyCompany: false,
				myClaimStatus: null,
			}),
		]);
	});

	it("claims a provider only on a domain match and only once", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);

		const wrongProvider = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "deepseek" }),
		);
		expect(wrongProvider.status).toBe(403);

		const claim = await claimProvider(cookie, company.id);
		expect(claim.providerId).toBe("mistral");
		// Claims land pending: carriers only go live once we approve them.
		expect(claim.status).toBe("pending");

		// A company can hold several providers, but a provider only one live
		// claim — even while the first one is still under review.
		const secondCompany = await createCompany(cookie, "Mistral EU");
		const duplicate = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: secondCompany.id,
				providerId: "mistral",
			}),
		);
		expect(duplicate.status).toBe(409);

		// The claim shows up on /claimable as under review by my company.
		const claimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await claimable.json()).providers[0]).toMatchObject({
			claimed: true,
			claimedByMyCompany: true,
			myClaimStatus: "pending",
		});
	});

	it("blocks model listing until the claim is approved", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		const res = await createModel(cookie, company.id);
		expect(res.status).toBe(403);
		expect((await res.json()).message).toContain("under review");

		await activateClaim();
		const approved = await createModel(cookie, company.id);
		expect(approved.status).toBe(201);
	});

	it("runs the claim review lifecycle through the admin queue", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);

		const queue = await app.request("/admin/airside/claims?status=pending", {
			headers: { Cookie: cookie },
		});
		expect(queue.status).toBe(200);
		const queueBody = await queue.json();
		expect(queueBody.pendingCount).toBe(1);
		expect(queueBody.claims[0]).toMatchObject({
			id: claim.id,
			providerId: "mistral",
			matchedDomain: "mistral.ai",
			claimedByEmail: "ops@mistral.ai",
			company: expect.objectContaining({ name: "Mistral Ops" }),
		});

		// Reject → the provider becomes claimable again.
		const rejected = await app.request(
			`/admin/airside/claims/${claim.id}/reject`,
			json(cookie, { reviewNote: "Cannot verify the company" }),
		);
		expect(rejected.status).toBe(200);
		expect((await rejected.json()).claim.status).toBe("rejected");

		const reclaimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await reclaimable.json()).providers[0]).toMatchObject({
			claimed: false,
			myClaimStatus: null,
		});

		// Re-claim and approve → active, with routing settings provisioned.
		const secondClaim = await claimProvider(cookie, company.id);
		const approved = await app.request(
			`/admin/airside/claims/${secondClaim.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		expect((await approved.json()).claim.status).toBe("active");

		// Re-review of the same claim conflicts.
		const again = await app.request(
			`/admin/airside/claims/${secondClaim.id}/approve`,
			json(cookie),
		);
		expect(again.status).toBe(409);

		const settings = await db.query.providerRoutingSettings.findFirst({
			where: { providerId: { eq: "mistral" } },
		});
		expect(settings).toBeTruthy();
	});

	it("queues capability checks and gates a new mapping on their result", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const mapping = {
			providerCompanyId: company.id,
			providerId: "mistral",
			modelName: "mistral-verified-x",
			externalId: "mistral-verified-upstream",
			streaming: true,
			tools: true,
			jsonOutput: true,
			jsonOutputSchema: true,
			reasoning: true,
			reasoningMaxTokens: true,
			reasoningEfforts: ["low" as const],
			webSearch: true,
			contextSize: 128000,
			maxOutput: 4096,
		};
		const queueAttempts = await Promise.all(
			Array.from({ length: 4 }, () =>
				app.request(
					"/airside/model-verifications",
					json(cookie, { ...mapping, apiKey: "provider-secret-for-test" }),
				),
			),
		);
		const queued = queueAttempts.find((response) => response.status === 202);
		const conflicts = queueAttempts.filter(
			(response) => response.status === 409,
		);
		expect(queued).toBeDefined();
		expect(conflicts).toHaveLength(3);
		for (const conflict of conflicts) {
			expect((await conflict.json()).message).toContain("already in progress");
		}
		if (!queued) {
			throw new Error("Expected one verification to be queued.");
		}
		const queuedBody = await queued.json();
		expect(JSON.stringify(queuedBody)).not.toContain(
			"provider-secret-for-test",
		);
		expect(queuedBody.verification).toMatchObject({
			status: "queued",
			checks: expect.arrayContaining([
				expect.objectContaining({ id: "basic", status: "queued" }),
				expect.objectContaining({ id: "streaming" }),
				expect.objectContaining({ id: "tools" }),
				expect.objectContaining({ id: "structured_json" }),
				expect.objectContaining({ id: "reasoning_budget" }),
				expect.objectContaining({ id: "web_search" }),
				expect.objectContaining({ id: "context_size" }),
				expect.objectContaining({ id: "max_output" }),
			]),
		});
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: queuedBody.verification.id } },
		});
		expect(stored?.credentialCiphertext).toMatch(/^llmgw:v2:/);
		expect(stored?.credentialCiphertext).not.toContain(
			"provider-secret-for-test",
		);
		const activeVerifications =
			await db.query.providerModelVerification.findMany({
				where: {
					providerCompanyId: { eq: company.id },
					status: { in: ["queued", "running"] },
				},
			});
		expect(activeVerifications).toHaveLength(1);
		const otherTarget = await app.request(
			"/airside/model-verifications",
			json(cookie, {
				...mapping,
				modelName: "mistral-verified-y",
				apiKey: "provider-secret-for-test",
			}),
		);
		expect(otherTarget.status).toBe(202);

		const submission = {
			...mapping,
			verificationId: queuedBody.verification.id as string,
			family: "mistral",
			pricing: { inputPrice: "2e-6", outputPrice: "6e-6" },
		};
		const impending = await app.request(
			"/airside/models",
			json(cookie, submission),
		);
		expect(impending.status).toBe(409);
		expect((await impending.json()).message).toContain("must pass");

		await db
			.update(tables.providerModelVerification)
			.set({
				status: "passed",
				checks: stored!.checks.map((check) => ({
					...check,
					status: "passed" as const,
					feedback: "Passed",
				})),
				completedAt: new Date(),
				credentialCiphertext: null,
			})
			.where(eq(tables.providerModelVerification.id, stored!.id));
		const widened = await app.request(
			"/airside/models",
			json(cookie, { ...submission, contextSize: 256000 }),
		);
		expect(widened.status).toBe(409);
		expect((await widened.json()).message).toContain(
			"changed after verification",
		);
		const created = await app.request(
			"/airside/models",
			json(cookie, submission),
		);
		expect(created.status).toBe(201);
		const createdBody = await created.json();
		expect(createdBody.model).toMatchObject({
			modelName: "mistral-verified-x",
			jsonOutputSchema: true,
			reasoningMaxTokens: true,
			webSearch: true,
			latestVerification: expect.objectContaining({ status: "passed" }),
		});
		const patched = await app.request(
			`/airside/models/${createdBody.model.id}`,
			json(cookie, { displayName: "Mistral Verified X" }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model.latestVerification).toMatchObject({
			status: "passed",
		});
		const consumed = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: stored!.id } },
		});
		expect(consumed?.draftModelId).toBe(createdBody.model.id);
		expect(consumed?.submittedAt).toBeInstanceOf(Date);
	});

	it("never spends a platform credential on a carrier's verification", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		// A managed key that could serve this model exists — and still must not
		// run a carrier's preflight, because that traffic is neither logged nor
		// billed and would land on our provider bill.
		const providerKeyId = `verification-key-${crypto.randomUUID()}`;
		await db.insert(tables.providerKey).values({
			id: providerKeyId,
			provider: "mistral",
			...encryptProviderKeyForStorage(
				"managed-provider-test-key",
				providerKeyId,
				null,
			),
			managed: true,
			allowedModels: ["mistral-upstream-id"],
		});

		const queued = await app.request(
			"/airside/model-verifications",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				modelName: "mistral-public-id",
				externalId: "mistral-upstream-id",
			}),
		);

		expect(queued.status).toBe(400);
		expect((await queued.json()).message).toContain("provider API key");
	});

	it("saves the carrier's key on the claim and reuses it", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		await activateClaim();

		const first = await app.request(
			"/airside/model-verifications",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				modelName: "mistral-saves-key",
				apiKey: "carrier-saved-key",
			}),
		);
		expect(first.status).toBe(202);
		expect((await first.json()).verification).toBeDefined();

		const savedClaim = await db.query.providerClaim.findFirst({
			where: { id: { eq: claim.id } },
		});
		expect(savedClaim?.verificationKeyCiphertext).toMatch(/^llmgw:v2:/);
		expect(savedClaim?.verificationKeyCiphertext).not.toContain(
			"carrier-saved-key",
		);
		expect(savedClaim?.verificationKeyMasked).toContain("•");
		expect(savedClaim?.verificationKeyMasked).not.toBe("carrier-saved-key");
		expect(savedClaim?.verificationKeyUpdatedAt).toBeInstanceOf(Date);

		// A later run needs no key: the claim holds one.
		const second = await app.request(
			"/airside/model-verifications",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				modelName: "mistral-reuses-key",
			}),
		);
		expect(second.status).toBe(202);
		const reused = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: (await second.json()).verification.id } },
		});
		expect(reused?.credentialSource).toBe("carrier");
		expect(reused?.credentialCiphertext).toMatch(/^llmgw:v2:/);

		// The carrier sees it masked, never the plaintext or the ciphertext.
		const companies = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		const listed = await companies.json();
		expect(JSON.stringify(listed)).not.toContain("carrier-saved-key");
		expect(listed.companies[0].claims[0].verificationKeyMasked).toBe(
			savedClaim?.verificationKeyMasked,
		);
		expect(listed.companies[0].claims[0].verificationKeySetAt).toBeTruthy();
	});

	it("manages the saved verification key from settings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		await activateClaim();

		const saved = await app.request(
			`/airside/claims/${claim.id}/verification-key`,
			json(cookie, { apiKey: "settings-saved-key" }, "PUT"),
		);
		expect(saved.status).toBe(200);
		const savedBody = await saved.json();
		expect(savedBody.verificationKeyMasked).not.toBe("settings-saved-key");
		expect(savedBody.verificationKeySetAt).toBeTruthy();

		// A non-member gets the same 404 every company-scoped route returns, so
		// the claim's existence stays hidden.
		const outsider = await createSecondUser("stranger@example.com");
		const forbidden = await app.request(
			`/airside/claims/${claim.id}/verification-key`,
			json(outsider, { apiKey: "not-yours" }, "PUT"),
		);
		expect(forbidden.status).toBe(404);

		const removed = await app.request(
			`/airside/claims/${claim.id}/verification-key`,
			json(cookie, undefined, "DELETE"),
		);
		expect(removed.status).toBe(200);
		const cleared = await db.query.providerClaim.findFirst({
			where: { id: { eq: claim.id } },
		});
		expect(cleared?.verificationKeyCiphertext).toBeNull();
		expect(cleared?.verificationKeyMasked).toBeNull();
		expect(cleared?.verificationKeyUpdatedAt).toBeNull();

		// With the key gone, preflight asks for one again.
		const queued = await app.request(
			"/airside/model-verifications",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				modelName: "mistral-needs-key-again",
			}),
		);
		expect(queued.status).toBe(400);
	});

	it("carries a carrier's tool_choice narrowing and preflights an edit", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			supportedToolChoices: ["auto", "none"],
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model.supportedToolChoices).toEqual(["auto", "none"]);

		// A draft applies metadata in place, so the narrowing is editable.
		await passPreflight(model.id);
		const patched = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { supportedToolChoices: null }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model.supportedToolChoices).toBeNull();

		// A preflight of unsaved capabilities verifies the proposal, not the row.
		const queued = await app.request(
			`/airside/models/${model.id}/verifications`,
			json(cookie, {
				apiKey: "carrier-preflight-key",
				proposed: { supportedToolChoices: ["auto"], vision: true },
			}),
		);
		expect(queued.status).toBe(202);
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: (await queued.json()).verification.id } },
		});
		expect(stored?.target).toMatchObject({
			supportedToolChoices: ["auto"],
			vision: true,
			// Untouched fields still come from the saved listing.
			tools: true,
			modelName: "mistral-large-3",
		});
	});

	it("requires a passing preflight to widen a listing or relist it", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const { model } = await (await createModel(cookie, company.id)).json();
		const patch = async (body: Record<string, unknown>) =>
			await app.request(
				`/airside/models/${model.id}`,
				json(cookie, body, "PATCH"),
			);

		// Claiming more than the listing proved needs a preflight first.
		const widened = await patch({ vision: true });
		expect(widened.status).toBe(409);
		expect((await widened.json()).message).toContain("Run preflight");
		expect((await patch({ contextSize: 512000 })).status).toBe(409);
		// Narrowing and descriptive edits need none.
		expect((await patch({ tools: false })).status).toBe(200);
		expect((await patch({ displayName: "Mistral Large 3 Turbo" })).status).toBe(
			200,
		);

		await passPreflight(model.id);
		expect((await patch({ vision: true })).status).toBe(200);
		// Only the latest run counts: a later failure blocks again.
		await db.insert(tables.providerModelVerification).values({
			id: `verification-${crypto.randomUUID()}`,
			providerCompanyId: company.id,
			draftModelId: model.id,
			requestedBy: "test-user-id",
			target: {
				providerId: "mistral",
				modelName: model.modelName,
				externalId: model.modelName,
				streaming: true,
				vision: true,
				audio: true,
				tools: true,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: false,
				reasoningMaxTokens: false,
				reasoningEfforts: null,
				webSearch: false,
			},
			checks: [],
			status: "failed",
			completedAt: new Date(),
		});
		expect((await patch({ audio: true })).status).toBe(409);

		// A delisted model relists only after a preflight run since delisting.
		await db
			.update(tables.providerDraftModel)
			.set({ status: "delisted", delistedAt: new Date() })
			.where(eq(tables.providerDraftModel.id, model.id));
		const relist = async () =>
			await app.request(`/airside/models/${model.id}/relist`, json(cookie));
		const blocked = await relist();
		expect(blocked.status).toBe(409);
		expect((await blocked.json()).message).toContain("before you relist");
	});

	it("lists a listing's preflight history without naming our reviewers", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id);
		expect(created.status).toBe(201);
		const { model } = await created.json();

		const carrierRun = await app.request(
			`/airside/models/${model.id}/verifications`,
			json(cookie, { apiKey: "carrier-history-key" }),
		);
		expect(carrierRun.status).toBe(202);
		const carrierRunId = (await carrierRun.json()).verification.id;
		// Only one run may be in flight per listing, so settle this one first.
		await db
			.update(tables.providerModelVerification)
			.set({ status: "failed", summary: "tools failed" })
			.where(eq(tables.providerModelVerification.id, carrierRunId));

		const carrierRow = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: carrierRunId } },
		});
		const adminRunId = `admin-run-${crypto.randomUUID()}`;
		await db.insert(tables.providerModelVerification).values({
			id: adminRunId,
			providerCompanyId: company.id,
			draftModelId: model.id,
			initiatedBy: "admin",
			requestedBy: "test-user-id",
			target: carrierRow!.target,
			checks: [{ id: "basic", label: "Basic completion", status: "passed" }],
			status: "passed",
			summary: "spot check ok",
		});

		const res = await app.request(`/airside/models/${model.id}/verifications`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const { verifications } = await res.json();
		// Newest first, down to the run that registered the listing.
		expect(
			verifications.slice(0, 2).map((entry: { id: string }) => entry.id),
		).toEqual([adminRunId, carrierRunId]);
		expect(verifications).toHaveLength(3);
		// Our side is named only as the initiator; the reviewer stays anonymous.
		expect(verifications[0]).toMatchObject({
			initiatedBy: "admin",
			actorName: null,
			actorEmail: null,
			status: "passed",
		});
		expect(verifications[1]).toMatchObject({
			initiatedBy: "carrier",
			actorName: "Test User",
			actorEmail: null,
			status: "failed",
			summary: "tools failed",
		});

		// A non-member gets the company-scoped 404.
		const outsider = await createSecondUser("nosy@example.com");
		const denied = await app.request(
			`/airside/models/${model.id}/verifications`,
			{ headers: { Cookie: outsider } },
		);
		expect(denied.status).toBe(404);
	});

	it("verifies the capabilities a live listing has awaiting review", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			modelName: "mistral-large-3-review",
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		const live = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(live.status).toBe(200);

		// A live listing keeps a capability edit in a filing until it is
		// approved, so the row still says reasoning is off.
		await passPreflight(model.id);
		const filed = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { reasoning: true, reasoningEfforts: ["low"] }, "PATCH"),
		);
		expect(filed.status).toBe(200);
		expect((await filed.json()).model).toMatchObject({
			reasoning: false,
			pendingFiling: {
				kind: "metadata",
				metadata: { reasoning: true, reasoningEfforts: ["low"] },
			},
		});

		const queued = await app.request(
			`/airside/models/${model.id}/verifications`,
			json(cookie, { apiKey: "carrier-preflight-key" }),
		);
		expect(queued.status).toBe(202);
		const stored = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: (await queued.json()).verification.id } },
		});
		// Without the filing this run would skip reasoning entirely and report
		// a pass for a capability it never touched.
		expect(stored?.target).toMatchObject({
			reasoning: true,
			reasoningEfforts: ["low"],
			tools: true,
		});
		expect(stored?.checks.map((check) => check.id)).toContain("reasoning");
	});

	it("drafts a model with an initial price filing and blocks price edits", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const created = await createModel(cookie, company.id);
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model).toMatchObject({
			status: "draft",
			currentPricing: null,
			pendingFiling: expect.objectContaining({
				kind: "initial",
				status: "pending",
				inputPrice: "2e-6",
			}),
		});

		// Non-pricing edits apply immediately.
		const patched = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { displayName: "Mistral Large 3 Turbo" }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model.displayName).toBe(
			"Mistral Large 3 Turbo",
		);
		const verificationGated = await app.request(
			`/airside/models/${model.id}`,
			json(
				cookie,
				{
					jsonOutputSchema: true,
					reasoningMaxTokens: true,
					webSearch: true,
				},
				"PATCH",
			),
		);
		expect(verificationGated.status).toBe(200);
		expect((await verificationGated.json()).model).toMatchObject({
			jsonOutputSchema: false,
			reasoningMaxTokens: false,
			webSearch: false,
		});

		// A second filing can't be submitted while one is pending.
		const doubleFiling = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "1e-6", outputPrice: "3e-6" }),
		);
		expect(doubleFiling.status).toBe(409);

		// Duplicate live model names for the provider are rejected.
		const duplicate = await createModel(cookie, company.id);
		expect(duplicate.status).toBe(409);

		// Drafts delete outright.
		const deleted = await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect((await deleted.json()).status).toBe("deleted");
	});

	it("requires a claimed provider to list models", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const res = await createModel(cookie, company.id);
		expect(res.status).toBe(403);
	});

	it("scopes company resources to members", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await db
			.delete(tables.providerCompanyMember)
			.where(eq(tables.providerCompanyMember.providerCompanyId, company.id));
		const res = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(404);
	});

	it("runs the approval lifecycle through the admin queue", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id);
		const { model } = await created.json();
		const filingId = model.pendingFiling.id as string;

		const queue = await app.request("/admin/airside/filings?status=pending", {
			headers: { Cookie: cookie },
		});
		expect(queue.status).toBe(200);
		const queueBody = await queue.json();
		expect(queueBody.pendingCount).toBe(1);
		expect(queueBody.filings[0]).toMatchObject({
			id: filingId,
			kind: "initial",
			company: expect.objectContaining({ name: "Mistral Ops" }),
			model: expect.objectContaining({ modelName: "mistral-large-3" }),
		});

		// Approve the initial filing → model activates, pricing becomes current.
		const approved = await app.request(
			`/admin/airside/filings/${filingId}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const models = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const active = (await models.json()).models[0];
		expect(active).toMatchObject({
			status: "active",
			currentPricing: expect.objectContaining({ inputPrice: "2e-6" }),
			pendingFiling: null,
		});

		// Active models delist instead of deleting.
		// First file a price update and reject it: pricing must stay unchanged.
		const update = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "4e-6", outputPrice: "9e-6" }),
		);
		expect(update.status).toBe(201);
		const updateFiling = (await update.json()).filing;
		expect(updateFiling.kind).toBe("update");

		const rejected = await app.request(
			`/admin/airside/filings/${updateFiling.id}/reject`,
			json(cookie, { reviewNote: "Too steep" }),
		);
		expect(rejected.status).toBe(200);

		const afterReject = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const stillActive = (await afterReject.json()).models[0];
		expect(stillActive).toMatchObject({
			status: "active",
			currentPricing: expect.objectContaining({ inputPrice: "2e-6" }),
			pendingFiling: null,
		});

		// Re-review of the same filing conflicts.
		const again = await app.request(
			`/admin/airside/filings/${updateFiling.id}/reject`,
			json(cookie, {}),
		);
		expect(again.status).toBe(409);

		const delisted = await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect((await delisted.json()).status).toBe("delisted");
		const delistedList = await app.request(
			`/airside/models?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		expect((await delistedList.json()).models[0]).toMatchObject({
			status: "delisted",
			delistReason: "removed",
			delistedAt: expect.any(String),
		});
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { modelId: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();

		// A live listing holding the name blocks the relist.
		const [holder] = await db
			.insert(tables.providerDraftModel)
			.values({
				providerCompanyId: company.id,
				providerId: "mistral",
				modelName: "mistral-large-3",
				externalId: "mistral-large-3",
				family: "mistral",
			})
			.returning();
		await passPreflight(model.id);
		const blocked = await app.request(
			`/airside/models/${model.id}/relist`,
			json(cookie),
		);
		expect(blocked.status).toBe(409);
		await db
			.delete(tables.providerDraftModel)
			.where(eq(tables.providerDraftModel.id, holder.id));

		// Relisting restores service at the last approved fare, not the
		// rejected update.
		const relisted = await app.request(
			`/airside/models/${model.id}/relist`,
			json(cookie),
		);
		expect(relisted.status).toBe(200);
		expect((await relisted.json()).model).toMatchObject({
			status: "active",
			delistedAt: null,
			delistReason: null,
			currentPricing: expect.objectContaining({ inputPrice: "2e-6" }),
		});
		const restored = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(restored).toMatchObject({ source: "airside", status: "active" });
		expect(Number(restored!.inputPrice)).toBeCloseTo(2e-6);

		const relistAgain = await app.request(
			`/airside/models/${model.id}/relist`,
			json(cookie),
		);
		expect(relistAgain.status).toBe(409);
	});

	it("lists admin filings newest first with pagination", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const ids: string[] = [];
		for (const modelName of ["mistral-a", "mistral-b", "mistral-c"]) {
			const created = await createModel(cookie, company.id, { modelName });
			const { model } = await created.json();
			ids.push(model.pendingFiling.id as string);
		}
		for (const [index, id] of ids.entries()) {
			await db
				.update(tables.providerPriceFiling)
				.set({ createdAt: new Date(Date.UTC(2026, 0, index + 1)) })
				.where(eq(tables.providerPriceFiling.id, id));
		}

		const page = async (offset: number) => {
			const res = await app.request(
				`/admin/airside/filings?limit=2&offset=${offset}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			return await res.json();
		};
		const first = await page(0);
		expect(first.total).toBe(3);
		expect(first.filings.map((f: { id: string }) => f.id)).toEqual([
			ids[2],
			ids[1],
		]);
		const second = await page(2);
		expect(second.filings.map((f: { id: string }) => f.id)).toEqual([ids[0]]);
	});

	it("rejects admin queue access for non-admins", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "someone-else@example.com";
		const res = await app.request("/admin/airside/filings", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(403);
	});

	it("returns provider-scoped usage stats", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const hour = new Date();
		hour.setMinutes(0, 0, 0);
		await db.insert(tables.projectHourlyModelStats).values([
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "mistral-large-3",
				usedProvider: "mistral",
				requestCount: 10,
				errorCount: 3,
				clientErrorCount: 2,
				upstreamErrorCount: 1,
				inputTokens: "1000",
				outputTokens: "500",
				totalTokens: "1500",
				cost: 2,
			},
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "gpt-6",
				usedProvider: "openai",
				requestCount: 99,
				inputTokens: "9999",
				outputTokens: "9999",
				totalTokens: "19998",
				cost: 50,
			},
		]);

		const res = await app.request(
			`/airside/stats?providerCompanyId=${company.id}&days=7`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.providerIds).toEqual(["mistral"]);
		expect(body.totals).toMatchObject({
			requestCount: 10,
			errorCount: 1,
			cost: 2,
		});
		expect(body.byModel).toEqual([
			expect.objectContaining({
				providerId: "mistral",
				model: "mistral-large-3",
				requestCount: 10,
			}),
		]);
		expect(body.daily).toHaveLength(1);
	});

	it("returns per-mapping incidents scoped to claimed providers", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const hour = new Date();
		hour.setMinutes(0, 0, 0);
		await db.insert(tables.projectHourlyModelStats).values([
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "mistral/mistral-large-3",
				usedProvider: "mistral",
				requestCount: 10,
				errorCount: 5,
				clientErrorCount: 1,
				upstreamErrorCount: 3,
				gatewayErrorCount: 1,
				canceledCount: 1,
			},
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "mistral/mistral-small-4",
				usedProvider: "mistral",
				requestCount: 5,
			},
			{
				projectId: "test-project-id",
				hourTimestamp: hour,
				usedModel: "openai/gpt-6",
				usedProvider: "openai",
				requestCount: 99,
				errorCount: 50,
				upstreamErrorCount: 50,
			},
		]);

		const logs: {
			statusCode: number;
			retried: boolean;
			streamed: boolean;
			classification?: "client_error" | "canceled";
		}[] = [
			{ statusCode: 503, retried: false, streamed: true },
			{ statusCode: 503, retried: false, streamed: true },
			{ statusCode: 500, retried: true, streamed: false },
			{
				statusCode: 400,
				retried: false,
				streamed: false,
				classification: "client_error",
			},
			{
				statusCode: 502,
				retried: false,
				streamed: true,
				classification: "canceled",
			},
		];
		await db.insert(tables.log).values(
			logs.map((entry, i) => ({
				id: `incident-log-${i}`,
				requestId: `incident-request-${i}`,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				hasError: true,
				retried: entry.retried,
				streamed: entry.streamed,
				unifiedFinishReason: entry.classification ?? "upstream_error",
				errorDetails: {
					statusCode: entry.statusCode,
					statusText: "err",
					responseText: `failed ${entry.statusCode}`,
				},
				duration: 100,
				usedMode: "credits" as const,
				requestedModel: "mistral-large-3",
				requestedProvider: "mistral",
				usedModel: "mistral/mistral-large-3",
				usedProvider: "mistral",
				responseSize: 10,
				mode: "credits" as const,
			})),
		);

		// A 200 that failed mid-response: an upstream error without error
		// details, described by its raw finish reason.
		await db.insert(tables.log).values({
			id: "incident-log-aborted",
			requestId: "incident-request-aborted",
			organizationId: "test-org-id",
			projectId: "test-project-id",
			apiKeyId: "test-api-key-id",
			hasError: true,
			retried: false,
			streamed: true,
			finishReason: "abort",
			unifiedFinishReason: "upstream_error",
			duration: 100,
			usedMode: "credits" as const,
			requestedModel: "mistral-large-3",
			requestedProvider: "mistral",
			usedModel: "mistral/mistral-large-3",
			usedProvider: "mistral",
			responseSize: 10,
			mode: "credits" as const,
		});

		const base = `/airside/incidents?providerCompanyId=${company.id}`;
		const res = await app.request(base, { headers: { Cookie: cookie } });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.providerIds).toEqual(["mistral"]);
		expect(body.windowHours).toBe(24);
		expect(body.mappings).toEqual([
			{
				providerId: "mistral",
				providerName: "Mistral AI",
				usedModel: "mistral/mistral-large-3",
				modelId: "mistral-large-3",
				region: null,
				requestCount: 10,
				errorCount: 4,
				upstreamErrorCount: 3,
				gatewayErrorCount: 1,
				errorRate: 0.4,
			},
		]);

		// A filtered mapping without errors still returns its row.
		const filtered = await app.request(
			`${base}&mapping=mistral/mistral-small-4`,
			{ headers: { Cookie: cookie } },
		);
		const filteredBody = await filtered.json();
		expect(filteredBody.mapping).toBe("mistral/mistral-small-4");
		expect(filteredBody.mappings).toEqual([
			expect.objectContaining({
				usedModel: "mistral/mistral-small-4",
				errorCount: 0,
				errorRate: 0,
			}),
		]);

		const tooWide = await app.request(`${base}&window=7d`, {
			headers: { Cookie: cookie },
		});
		expect(tooWide.status).toBe(400);

		const foreign = await app.request(`${base}&providerId=openai`, {
			headers: { Cookie: cookie },
		});
		expect(foreign.status).toBe(404);

		const errorsBase = `/airside/incidents/errors?providerCompanyId=${company.id}&providerId=mistral&mapping=mistral/mistral-large-3`;
		const errors = await app.request(errorsBase, {
			headers: { Cookie: cookie },
		});
		expect(errors.status).toBe(200);
		const errorsBody = await errors.json();
		// Every error the row counts, not a sample of them.
		expect(errorsBody.sampledErrors).toBe(4);
		expect(errorsBody.capped).toBe(false);
		expect(errorsBody.errors).toHaveLength(3);
		expect(errorsBody.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ statusCode: 503, streamed: true, count: 2 }),
				expect.objectContaining({
					statusCode: 500,
					streamed: false,
					count: 1,
				}),
				expect.objectContaining({
					statusCode: null,
					statusText: "abort",
					classification: "upstream_error",
					streamed: true,
					count: 1,
				}),
			]),
		);

		const notRetried = await app.request(`${errorsBase}&includeRetried=false`, {
			headers: { Cookie: cookie },
		});
		const notRetriedBody = await notRetried.json();
		expect(notRetriedBody.sampledErrors).toBe(3);

		// The same errors grouped by type across mappings instead of per mapping.
		await db.insert(tables.projectHourlyModelStats).values({
			projectId: "test-project-id",
			hourTimestamp: hour,
			usedModel: "mistral/mistral-medium-3",
			usedProvider: "mistral",
			requestCount: 4,
			errorCount: 1,
			upstreamErrorCount: 1,
		});
		await db.insert(tables.log).values({
			id: "incident-log-other-model",
			requestId: "incident-request-other-model",
			organizationId: "test-org-id",
			projectId: "test-project-id",
			apiKeyId: "test-api-key-id",
			hasError: true,
			retried: false,
			streamed: false,
			unifiedFinishReason: "upstream_error",
			errorDetails: {
				statusCode: 503,
				statusText: "err",
				responseText: "failed 503",
			},
			duration: 100,
			usedMode: "credits" as const,
			requestedModel: "mistral-medium-3",
			requestedProvider: "mistral",
			usedModel: "mistral/mistral-medium-3",
			usedProvider: "mistral",
			responseSize: 10,
			mode: "credits" as const,
		});
		const typesBase = `/airside/incidents/error-types?providerCompanyId=${company.id}`;
		const types = await app.request(typesBase, {
			headers: { Cookie: cookie },
		});
		expect(types.status).toBe(200);
		const typesBody = await types.json();
		expect(typesBody).toMatchObject({
			sampledErrors: 5,
			sampleLimit: 100_000,
			cappedMappings: 0,
		});
		expect(typesBody.errors).toHaveLength(3);
		expect(typesBody.errors).toContainEqual(
			expect.objectContaining({
				statusCode: null,
				statusText: "abort",
				count: 1,
				streamedCount: 1,
			}),
		);
		expect(typesBody.errors.slice(0, 1)).toEqual([
			expect.objectContaining({
				statusCode: 503,
				count: 3,
				streamedCount: 2,
				models: [
					{
						providerId: "mistral",
						usedModel: "mistral/mistral-large-3",
						modelId: "mistral-large-3",
						region: null,
						count: 2,
						streamedCount: 2,
					},
					{
						providerId: "mistral",
						usedModel: "mistral/mistral-medium-3",
						modelId: "mistral-medium-3",
						region: null,
						count: 1,
						streamedCount: 0,
					},
				],
			}),
		]);
		expect(typesBody.errors).toContainEqual(
			expect.objectContaining({
				statusCode: 500,
				count: 1,
				streamedCount: 0,
				models: [expect.objectContaining({ modelId: "mistral-large-3" })],
			}),
		);

		const typesNotRetried = await app.request(
			`${typesBase}&includeRetried=false&mapping=mistral/mistral-large-3`,
			{ headers: { Cookie: cookie } },
		);
		const typesNotRetriedBody = await typesNotRetried.json();
		expect(typesNotRetriedBody.sampledErrors).toBe(3);
		expect(typesNotRetriedBody.errors).toHaveLength(2);

		const foreignTypes = await app.request(`${typesBase}&providerId=openai`, {
			headers: { Cookie: cookie },
		});
		expect(foreignTypes.status).toBe(404);

		const foreignErrors = await app.request(
			`/airside/incidents/errors?providerCompanyId=${company.id}&providerId=openai&mapping=openai/gpt-6`,
			{ headers: { Cookie: cookie } },
		);
		expect(foreignErrors.status).toBe(404);

		// Admins see the same per-mapping view for any provider.
		const adminDenied = await app.request(
			"/admin/airside/incidents?providerId=mistral",
			{ headers: { Cookie: cookie } },
		);
		expect(adminDenied.status).toBe(403);
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		const adminView = await app.request(
			"/admin/airside/incidents?providerId=mistral",
			{ headers: { Cookie: cookie } },
		);
		expect(adminView.status).toBe(200);
		expect((await adminView.json()).mappings).toEqual(
			expect.arrayContaining(body.mappings),
		);
		const adminTypes = await app.request(
			"/admin/airside/incidents/error-types?providerId=mistral",
			{ headers: { Cookie: cookie } },
		);
		expect(adminTypes.status).toBe(200);
		// The admin view adds each error's occurrences over time for its graph.
		const adminTypesBody = await adminTypes.json();
		expect(adminTypesBody.timeline.bucketSeconds).toBe(1800);
		expect(
			adminTypesBody.errors.map(
				(error: { buckets: { start: number; count: number }[] }) =>
					error.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
			),
		).toEqual(typesBody.errors.map((error: { count: number }) => error.count));
		expect(
			adminTypesBody.errors.map(
				({ buckets: _buckets, ...error }: { buckets: unknown }) => error,
			),
		).toEqual(typesBody.errors);

		const outsider = await createSecondUser("outsider@example.com");
		for (const path of [base, errorsBase, typesBase]) {
			const denied = await app.request(path, {
				headers: { Cookie: outsider },
			});
			expect(denied.status).toBe(404);
		}
	});

	it("gates claims on the listing fee when configured", async () => {
		process.env.AIRSIDE_LISTING_PRICE_ID = "price_test_airside";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);

		const gated = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(gated.status).toBe(402);

		// The webhook marks the company paid; simulate its write.
		await db
			.update(tables.providerCompany)
			.set({ paymentStatus: "paid", paidAt: new Date() })
			.where(eq(tables.providerCompany.id, company.id));
		const claimed = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(claimed.status).toBe(201);

		// Companies expose the payment state to the portal.
		const companies = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		expect((await companies.json()).companies[0]).toMatchObject({
			paymentStatus: "paid",
			paymentRequired: true,
		});
	});

	it("stores claim branding and serves it on internal providers", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		// Branding uploads are SVG-only; other image formats are rejected.
		const pngRes = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				logoUrl: `data:image/png;base64,${"A".repeat(64)}`,
			}),
		);
		expect(pngRes.status).toBe(400);
		const logoUrl = `data:image/svg+xml;base64,${"A".repeat(64)}`;
		const res = await app.request(
			"/airside/claims",
			json(cookie, {
				providerCompanyId: company.id,
				providerId: "mistral",
				logoUrl,
			}),
		);
		expect(res.status).toBe(201);
		expect((await res.json()).claim.logoUrl).toBe(logoUrl);
		await activateClaim();

		await db
			.insert(tables.provider)
			.values({ id: "mistral", name: "Mistral", description: "" })
			.onConflictDoNothing();
		const providersRes = await app.request("/internal/providers");
		const { providers } = await providersRes.json();
		const mistral = providers.find((p: { id: string }) => p.id === "mistral");
		expect(mistral.airsideLogoUrl).toBe(logoUrl);
	});

	it("round-trips carrier rate limits on models", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			maxRpm: 60,
			maxRpd: 20000,
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model).toMatchObject({ maxRpm: 60, maxRpd: 20000 });

		const patched = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { maxRpm: 30, maxRpd: null }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model).toMatchObject({
			maxRpm: 30,
			maxRpd: null,
		});
	});

	it("reviews quantization changes before publishing them", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			quantization: "fp8",
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model.quantization).toBe("fp8");
		const patch = (body: Record<string, unknown>) =>
			app.request(`/airside/models/${model.id}`, json(cookie, body, "PATCH"));
		const publicQuantization = async () => {
			const response = await app.request("/internal/models");
			expect(response.status).toBe(200);
			const { models } = await response.json();
			return models.find(
				(entry: { id: string }) => entry.id === model.modelName,
			).mappings[0].quantization;
		};
		const draft = await patch({ quantization: "bf16" });
		expect(draft.status).toBe(200);
		expect((await draft.json()).model.quantization).toBe("bf16");
		expect((await patch({ quantization: "invalid" })).status).toBe(400);
		const outsider = await createSecondUser("outsider@example.com");
		expect(
			(
				await app.request(
					`/airside/models/${model.id}`,
					json(outsider, { quantization: "fp4" }, "PATCH"),
				)
			).status,
		).toBe(404);
		const approved = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		expect(await publicQuantization()).toBe("bf16");
		const filed = await patch({ quantization: "fp4" });
		const pending = (await filed.json()).model;
		expect(pending).toMatchObject({
			quantization: "bf16",
			pendingFiling: { kind: "metadata", metadata: { quantization: "fp4" } },
		});
		expect(await publicQuantization()).toBe("bf16");
		const rejected = await app.request(
			`/admin/airside/filings/${pending.pendingFiling.id}/reject`,
			json(cookie, {}),
		);
		expect(rejected.status).toBe(200);
		expect(await publicQuantization()).toBe("bf16");
		for (const quantization of ["fp4", null]) {
			const filed = await patch({ quantization });
			expect(filed.status).toBe(200);
			const { model: next } = await filed.json();
			const approved = await app.request(
				`/admin/airside/filings/${next.pendingFiling.id}/approve`,
				json(cookie),
			);
			expect(approved.status).toBe(200);
			expect(await publicQuantization()).toBe(quantization);
			const listed = await app.request(
				`/airside/models?providerCompanyId=${company.id}`,
				{ headers: { Cookie: cookie } },
			);
			expect((await listed.json()).models[0].quantization).toBe(quantization);
		}
		expect(
			(await (await patch({ quantization: null })).json()).model.pendingFiling,
		).toBeNull();
	});

	it("materializes approved listings into the DB catalogue", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id);
		const { model } = await created.json();

		// Drafts are not in the catalogue yet.
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { modelId: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();

		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(mapping).toMatchObject({
			providerId: "mistral",
			externalId: "mistral-large-3",
			source: "airside",
			status: "active",
		});
		expect(Number(mapping!.inputPrice)).toBeCloseTo(2e-6);
		const catalogueModel = await db.query.model.findFirst({
			where: { id: { eq: "mistral-large-3" } },
		});
		expect(catalogueModel).toMatchObject({ family: "mistral" });
		const publicModels = await app.request("/internal/models");
		expect(publicModels.status).toBe(200);
		const published = (await publicModels.json()).models.find(
			(entry: { id: string }) => entry.id === "mistral-large-3",
		);
		expect(published).toMatchObject({
			name: "Mistral Large 3",
			mappings: [
				expect.objectContaining({
					providerId: "mistral",
					audio: false,
					tools: true,
				}),
			],
		});
		expect(Number(published.mappings[0].inputPrice)).toBeCloseTo(2e-6);

		// Metadata edits on a live listing are filed, not applied.
		await passPreflight(model.id);
		const filed = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { contextSize: 128000, tools: false }, "PATCH"),
		);
		expect(filed.status).toBe(200);
		const metadataFiling = (await filed.json()).model.pendingFiling;
		expect(metadataFiling).toMatchObject({
			kind: "metadata",
			metadata: { contextSize: 128000, tools: false },
		});
		const beforeApproval = (
			await (await app.request("/internal/models")).json()
		).models.find((entry: { id: string }) => entry.id === "mistral-large-3");
		expect(beforeApproval.mappings[0]).toMatchObject({
			contextSize: 256000,
			tools: true,
		});
		// A second edit replaces the pending change instead of queueing.
		const second = await app.request(
			`/airside/models/${model.id}`,
			json(
				cookie,
				{ contextSize: 128000, tools: false, maxOutput: 4096 },
				"PATCH",
			),
		);
		expect(second.status).toBe(200);
		expect((await second.json()).model.pendingFiling).toMatchObject({
			id: metadataFiling.id,
			kind: "metadata",
			metadata: { contextSize: 128000, tools: false, maxOutput: 4096 },
		});
		const queued = await app.request("/admin/airside/filings?status=pending", {
			headers: { Cookie: cookie },
		});
		const queuedFiling = (await queued.json()).filings.find(
			(entry: { id: string }) => entry.id === metadataFiling.id,
		);
		expect(queuedFiling).toMatchObject({
			kind: "metadata",
			currentMetadata: { contextSize: 256000, tools: true },
		});
		await app.request(
			`/admin/airside/filings/${metadataFiling.id}/approve`,
			json(cookie),
		);
		const afterMetadataUpdate = await app.request("/internal/models");
		const updatedMetadata = (await afterMetadataUpdate.json()).models.find(
			(entry: { id: string }) => entry.id === "mistral-large-3",
		);
		expect(updatedMetadata.mappings[0]).toMatchObject({
			contextSize: 128000,
			tools: false,
			maxOutput: 4096,
		});
		// Saving the current values again is a no-op, not another filing.
		const unchanged = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { contextSize: 128000, tools: false }, "PATCH"),
		);
		expect(unchanged.status).toBe(200);
		expect((await unchanged.json()).model.pendingFiling).toBeNull();

		// A price-update approval upserts the mapping and its prices.
		const update = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "4e-6", outputPrice: "9e-6" }),
		);
		const updateFiling = (await update.json()).filing;
		await db
			.delete(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.id, mapping!.id));
		await app.request(
			`/admin/airside/filings/${updateFiling.id}/approve`,
			json(cookie),
		);
		const repriced = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(Number(repriced!.inputPrice)).toBeCloseTo(4e-6);
		const afterPriceUpdate = await app.request("/internal/models");
		const updatedPrice = (await afterPriceUpdate.json()).models.find(
			(entry: { id: string }) => entry.id === "mistral-large-3",
		);
		expect(Number(updatedPrice.mappings[0].inputPrice)).toBeCloseTo(4e-6);

		// Delisting removes the materialized rows again.
		await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { modelId: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();
		expect(
			await db.query.model.findFirst({
				where: { id: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();
	});

	it("pauses and resumes a live listing without review", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const { model } = await (await createModel(cookie, company.id)).json();

		const draftPause = await app.request(
			`/airside/models/${model.id}/pause`,
			json(cookie),
		);
		expect(draftPause.status).toBe(409);

		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		const mappingStatus = async () =>
			(
				await db.query.modelProviderMapping.findMany({
					where: { modelId: { eq: "mistral-large-3" } },
				})
			).map((row) => row.status);

		const paused = await app.request(
			`/airside/models/${model.id}/pause`,
			json(cookie),
		);
		expect(paused.status).toBe(200);
		const pausedModel = (await paused.json()).model;
		expect(pausedModel.status).toBe("active");
		expect(pausedModel.pausedAt).toEqual(expect.any(String));
		expect(pausedModel.currentPricing).not.toBeNull();
		expect(await mappingStatus()).toEqual(["inactive"]);
		const pausedAgain = await app.request(
			`/airside/models/${model.id}/pause`,
			json(cookie),
		);
		expect(pausedAgain.status).toBe(409);

		// An approval landing while paused reprices without resuming.
		const update = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "4e-6", outputPrice: "9e-6" }),
		);
		await app.request(
			`/admin/airside/filings/${(await update.json()).filing.id}/approve`,
			json(cookie),
		);
		expect(await mappingStatus()).toEqual(["inactive"]);

		const resumed = await app.request(
			`/airside/models/${model.id}/resume`,
			json(cookie),
		);
		expect(resumed.status).toBe(200);
		expect((await resumed.json()).model.pausedAt).toBeNull();
		expect(await mappingStatus()).toEqual(["active"]);
		const resumedAgain = await app.request(
			`/airside/models/${model.id}/resume`,
			json(cookie),
		);
		expect(resumedAgain.status).toBe(409);
	});

	it("replaces or withdraws a pending change and waits behind a fare filing", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const { model } = await (await createModel(cookie, company.id)).json();
		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);

		const filed = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { contextSize: 128000 }, "PATCH"),
		);
		const first = (await filed.json()).model.pendingFiling;
		expect(first).toMatchObject({
			kind: "metadata",
			metadata: { contextSize: 128000 },
		});

		// Re-filing replaces the pending change wholesale, on the same row.
		const replaced = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { tools: false }, "PATCH"),
		);
		expect(replaced.status).toBe(200);
		expect((await replaced.json()).model.pendingFiling).toMatchObject({
			id: first.id,
			metadata: { tools: false },
		});
		expect(
			await db.query.providerPriceFiling.findMany({
				where: { draftModelId: { eq: model.id }, status: { eq: "pending" } },
			}),
		).toHaveLength(1);

		// An empty save keeps it; saving the live values back withdraws it.
		const empty = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, {}, "PATCH"),
		);
		expect((await empty.json()).model.pendingFiling).toMatchObject({
			id: first.id,
		});
		const withdrawn = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { tools: true }, "PATCH"),
		);
		expect(withdrawn.status).toBe(200);
		expect((await withdrawn.json()).model.pendingFiling).toBeNull();
		expect(
			await db.query.providerPriceFiling.findFirst({
				where: { id: { eq: first.id } },
			}),
		).toBeFalsy();

		// A pending fare filing still fences metadata edits.
		const fare = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "4e-6", outputPrice: "9e-6" }),
		);
		expect(fare.status).toBe(201);
		const fenced = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { tools: false }, "PATCH"),
		);
		expect(fenced.status).toBe(409);
	});

	it("materializes and replaces per-region fares", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			quantization: "fp8",
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{ region: "au", inputPrice: "3e-6", outputPrice: "8e-6" },
				],
			},
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model.pendingFiling.regionPrices).toEqual([
			{
				region: "au",
				inputPrice: "3e-6",
				outputPrice: "8e-6",
				cachedInputPrice: null,
				requestPrice: null,
			},
		]);

		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		const mappings = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(mappings).toHaveLength(2);
		expect(mappings.every((mapping) => mapping.quantization === "fp8")).toBe(
			true,
		);
		const auRow = mappings.find((mapping) => mapping.region === "au");
		expect(auRow).toMatchObject({ source: "airside", status: "active" });
		expect(Number(auRow!.inputPrice)).toBeCloseTo(3e-6);
		expect(Number(auRow!.outputPrice)).toBeCloseTo(8e-6);

		// A stale catalogue-sourced regional leftover is swept on the next
		// approved filing, and the filed set replaces the previous regions.
		await db.insert(tables.modelProviderMapping).values({
			modelId: "mistral-large-3",
			providerId: "mistral",
			region: "us",
			externalId: "mistral-large-3",
			source: "catalogue",
			inputPrice: "9e-6",
			outputPrice: "9e-6",
			streaming: true,
			status: "active",
		});
		const update = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{
						region: "eu-frankfurt",
						inputPrice: "4e-6",
						outputPrice: "9e-6",
						cachedInputPrice: "1e-6",
					},
				],
			}),
		);
		expect(update.status).toBe(201);
		const updateFiling = (await update.json()).filing;
		await app.request(
			`/admin/airside/filings/${updateFiling.id}/approve`,
			json(cookie),
		);
		const replaced = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(replaced.map((mapping) => mapping.region).sort()).toEqual([
			"eu-frankfurt",
			null,
		]);
		expect(replaced.every((mapping) => mapping.quantization === "fp8")).toBe(
			true,
		);
		const euRow = replaced.find((mapping) => mapping.region === "eu-frankfurt");
		expect(Number(euRow!.inputPrice)).toBeCloseTo(4e-6);
		expect(Number(euRow!.cachedInputPrice)).toBeCloseTo(1e-6);

		// Filing without regions drops every regional row.
		const flat = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, { inputPrice: "2e-6", outputPrice: "6e-6" }),
		);
		const flatFiling = (await flat.json()).filing;
		await app.request(
			`/admin/airside/filings/${flatFiling.id}/approve`,
			json(cookie),
		);
		const flatMappings = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(flatMappings).toHaveLength(1);
		expect(flatMappings[0].region).toBeNull();

		// Delisting removes everything.
		await app.request(`/airside/models/${model.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { modelId: { eq: "mistral-large-3" } },
			}),
		).toBeFalsy();
	});

	it("keeps regions consistent under a concurrent drop and filing", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{ region: "au", inputPrice: "3e-6", outputPrice: "8e-6" },
					{ region: "eu-frankfurt", inputPrice: "4e-6", outputPrice: "9e-6" },
				],
			},
		});
		const { model } = await created.json();
		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);

		// The model-row lock serializes these; whichever lands second sees the
		// first's write instead of interleaving with it.
		const [dropRes, filingRes] = await Promise.all([
			app.request(`/airside/models/${model.id}/regions/au`, {
				method: "DELETE",
				headers: { Cookie: cookie },
			}),
			app.request(
				`/airside/models/${model.id}/price-filings`,
				json(cookie, {
					inputPrice: "2e-6",
					outputPrice: "6e-6",
					regionPrices: [
						{ region: "au", inputPrice: "3e-6", outputPrice: "8e-6" },
					],
				}),
			),
		]);
		// Legal outcomes: drop first (filing then queues as pending) or filing
		// first (drop rejected while it is pending). Never both rejected.
		expect(dropRes.status === 200 || filingRes.status === 201).toBe(true);

		// The materialized regional rows always mirror the effective (latest
		// approved) filing — a drop can never resurrect or orphan a region.
		const approvedFilings = await db.query.providerPriceFiling.findMany({
			where: { draftModelId: { eq: model.id }, status: { eq: "approved" } },
			orderBy: { createdAt: "desc" },
		});
		const effectiveRegions = (approvedFilings[0].regionPrices ?? [])
			.map((entry) => entry.region)
			.sort();
		const mappings = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		const materializedRegions = mappings
			.map((mapping) => mapping.region)
			.filter(
				(mappingRegion): mappingRegion is string => mappingRegion !== null,
			)
			.sort();
		expect(materializedRegions).toEqual(effectiveRegions);
	});

	it("rejects malformed regional fares", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const badId = await createModel(cookie, company.id, {
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{ region: "AU!", inputPrice: "3e-6", outputPrice: "8e-6" },
				],
			},
		});
		expect(badId.status).toBe(400);
		const duplicate = await createModel(cookie, company.id, {
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{ region: "au", inputPrice: "3e-6", outputPrice: "8e-6" },
					{ region: "au", inputPrice: "4e-6", outputPrice: "9e-6" },
				],
			},
		});
		expect(duplicate.status).toBe(400);
	});

	it("drops a region immediately without a review cycle", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const created = await createModel(cookie, company.id, {
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{ region: "au", inputPrice: "3e-6", outputPrice: "8e-6" },
					{ region: "eu-frankfurt", inputPrice: "4e-6", outputPrice: "9e-6" },
				],
			},
		});
		const { model } = await created.json();
		const dropRegion = (region: string) =>
			app.request(`/airside/models/${model.id}/regions/${region}`, {
				method: "DELETE",
				headers: { Cookie: cookie },
			});

		// Drafts have no effective pricing to drop a region from.
		expect((await dropRegion("au")).status).toBe(409);

		const approveRes = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(approveRes.status).toBe(200);

		expect((await dropRegion("mars")).status).toBe(404);

		const removed = await dropRegion("au");
		expect(removed.status).toBe(200);
		const removedModel = (await removed.json()).model;
		expect(removedModel.currentPricing.regionPrices).toEqual([
			{
				region: "eu-frankfurt",
				inputPrice: "4e-6",
				outputPrice: "9e-6",
				cachedInputPrice: null,
				requestPrice: null,
			},
		]);
		expect(removedModel.pendingFiling).toBeNull();
		const mappings = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: "mistral-large-3" } },
		});
		expect(mappings.map((mapping) => mapping.region).sort()).toEqual([
			"eu-frankfurt",
			null,
		]);

		// Removing the last region leaves default-only pricing.
		const last = await dropRegion("eu-frankfurt");
		expect(last.status).toBe(200);
		expect((await last.json()).model.currentPricing.regionPrices).toBeNull();
		expect(
			(
				await db.query.modelProviderMapping.findMany({
					where: { modelId: { eq: "mistral-large-3" } },
				})
			).map((mapping) => mapping.region),
		).toEqual([null]);

		// A pending filing blocks removal so approval cannot resurrect the region.
		const pendingUpdate = await app.request(
			`/airside/models/${model.id}/price-filings`,
			json(cookie, {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				regionPrices: [
					{ region: "au", inputPrice: "3e-6", outputPrice: "8e-6" },
				],
			}),
		);
		expect(pendingUpdate.status).toBe(201);
		expect((await dropRegion("au")).status).toBe(409);
	});

	it("refuses listings that shadow the static catalogue", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "mistral-large-latest",
		});
		expect(res.status).toBe(409);
	});

	it("publishes a new provider mapping on an existing model", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const existingModel = (catalogueModels as readonly ModelDefinition[]).find(
			(model) =>
				!model.providers.some((mapping) => mapping.providerId === "mistral"),
		);
		expect(existingModel).toBeTruthy();

		const created = await createModel(cookie, company.id, {
			modelName: existingModel!.id,
			displayName: existingModel!.name ?? existingModel!.id,
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);

		const publicModels = await app.request("/internal/models");
		const published = (await publicModels.json()).models.find(
			(entry: { id: string }) => entry.id === existingModel!.id,
		);
		const publishedMapping = published.mappings.find(
			(mapping: { providerId: string }) => mapping.providerId === "mistral",
		);
		expect(publishedMapping).toMatchObject({
			providerId: "mistral",
			externalId: existingModel!.id,
		});
		expect(Number(publishedMapping.inputPrice)).toBeCloseTo(2e-6);
	});

	it("rejects malformed price strings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		for (const bad of ["", " ", "0x1F", "-1e-6", "1,4e-6"]) {
			const res = await createModel(cookie, company.id, {
				pricing: { inputPrice: bad, outputPrice: "1e-6" },
			});
			expect(res.status).toBe(400);
		}
	});

	it("keeps carrier settings independent of admin prioritization", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		// Admin provider prioritization is a separate internal knob — carrier
		// settings neither read nor touch it.
		await db.insert(tables.routingScoreMultiplier).values({
			provider: "mistral",
			model: null,
			scoreMultiplier: "0.5",
			reason: "manual penalty",
		});

		const filed = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.2,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(filed.status).toBe(201);
		const { filing } = await filed.json();
		const approved = await app.request(
			`/admin/airside/routing-filings/${filing.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		// The discounted price is adjusted by the accepted margin.
		expect((await approved.json()).filing.routingAdjustment).toBeCloseTo(-0.28);

		// The admin row is untouched, and no airside row was mirrored in.
		const multipliers = await db.query.routingScoreMultiplier.findMany({
			where: { provider: { eq: "mistral" } },
		});
		expect(multipliers).toHaveLength(1);
		expect(multipliers[0].reason).toBe("manual penalty");
		await db.delete(tables.routingScoreMultiplier);
	});

	it("revokes an active carrier and tears down its routing state", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		const approved = await app.request(
			`/admin/airside/claims/${claim.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);

		// Give the carrier a live boost first (fast-path, not the filing flow).
		await setRoutingSettings(company.id, "mistral", 0.1, 0.3);
		// Carrier settings never touch routing_score_multiplier.
		expect(
			await db.query.routingScoreMultiplier.findFirst({
				where: { provider: { eq: "mistral" } },
			}),
		).toBeFalsy();

		// A live listing exists at revocation time.
		const listed = await createModel(cookie, company.id);
		expect(listed.status).toBe(201);
		const listedModel = (await listed.json()).model;

		const revoked = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, { reviewNote: "Ownership dispute" }),
		);
		expect(revoked.status).toBe(200);
		expect((await revoked.json()).claim.status).toBe("revoked");

		// Revocation ends portal control: the listing is delisted and its
		// pending filing rejected.
		const deadModel = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: listedModel.id } },
		});
		expect(deadModel!.status).toBe("delisted");
		expect(deadModel!.delistReason).toBe("claim_revoked");
		// Without an active claim the listing stays history.
		const relist = await app.request(
			`/airside/models/${listedModel.id}/relist`,
			json(cookie),
		);
		expect(relist.status).toBe(403);
		const deadFiling = await db.query.providerPriceFiling.findFirst({
			where: { draftModelId: { eq: listedModel.id } },
		});
		expect(deadFiling!.status).toBe("rejected");
		expect(deadFiling!.reviewNote).toBe("Carrier claim revoked");

		// Settings are gone; the provider is claimable again.
		expect(
			await db.query.providerRoutingSettings.findFirst({
				where: { providerId: { eq: "mistral" } },
			}),
		).toBeFalsy();
		const claimable = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		expect((await claimable.json()).providers[0]).toMatchObject({
			claimed: false,
		});
		// Revoking twice conflicts.
		const again = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, {}),
		);
		expect(again.status).toBe(409);
	});

	it("runs fare changes through the admin approval queue", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const defaults = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const defaultsBody = await defaults.json();
		expect(defaultsBody.baselineMargin).toBe(0.2);
		expect(defaultsBody.settings[0]).toMatchObject({
			providerId: "mistral",
			marginPercent: 0.2,
			discountPercent: 0,
			routingAdjustment: 0,
			pendingFiling: null,
		});

		// Accepting a larger gateway margin + a discount → negative adjustment
		// (routing boost), but only as a pending filing.
		const filed = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.1,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(filed.status).toBe(201);
		const { filing } = await filed.json();
		expect(filing.status).toBe("pending");
		expect(filing.routingAdjustment).toBeCloseTo(-0.19);

		// Nothing is live yet, and the portal shows the pending filing.
		expect(
			await db.query.providerRoutingSettings.findFirst({
				where: { providerId: { eq: "mistral" } },
			}),
		).toBeFalsy();
		const whilePending = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		expect((await whilePending.json()).settings[0]).toMatchObject({
			marginPercent: 0.2,
			pendingFiling: expect.objectContaining({ id: filing.id }),
		});

		// One fare change in flight per provider.
		const doubled = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.2,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(doubled.status).toBe(409);

		// The admin queue lists it with the live values alongside.
		const queue = await app.request("/admin/airside/filings?status=pending", {
			headers: { Cookie: cookie },
		});
		const queueBody = await queue.json();
		expect(queueBody.routingPendingCount).toBe(1);
		expect(queueBody.routingFilings[0]).toMatchObject({
			id: filing.id,
			providerId: "mistral",
			currentDiscountPercent: 0,
			currentMarginPercent: 0.2,
		});

		// Approval applies the values to the live routing settings.
		const approved = await app.request(
			`/admin/airside/routing-filings/${filing.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const stored = await db.query.providerRoutingSettings.findFirst({
			where: { providerId: { eq: "mistral" } },
		});
		expect(Number(stored!.marginPercent)).toBeCloseTo(0.3);
		expect(Number(stored!.discountPercent)).toBeCloseTo(0.1);
		// The adjustment lives only in provider_routing_settings — no
		// routing_score_multiplier row is mirrored in.
		expect(
			await db.query.routingScoreMultiplier.findFirst({
				where: { provider: { eq: "mistral" } },
			}),
		).toBeFalsy();
		// Re-review conflicts.
		expect(
			(
				await app.request(
					`/admin/airside/routing-filings/${filing.id}/approve`,
					json(cookie),
				)
			).status,
		).toBe(409);

		// Filing the live values again is a no-op request.
		const noop = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.1,
					marginPercent: 0.3,
				},
				"PUT",
			),
		);
		expect(noop.status).toBe(400);

		// A rejected filing leaves the live settings untouched.
		const secondFiled = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0.3,
					marginPercent: 0.4,
				},
				"PUT",
			),
		);
		expect(secondFiled.status).toBe(201);
		const secondFiling = (await secondFiled.json()).filing;
		const rejected = await app.request(
			`/admin/airside/routing-filings/${secondFiling.id}/reject`,
			json(cookie, { reviewNote: "Too aggressive" }),
		);
		expect(rejected.status).toBe(200);
		const afterReject = await db.query.providerRoutingSettings.findFirst({
			where: { providerId: { eq: "mistral" } },
		});
		expect(Number(afterReject!.marginPercent)).toBeCloseTo(0.3);

		// The carrier's filing history carries the outcome and the note.
		const history = await app.request(
			`/airside/filings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const { routingFilings } = await history.json();
		expect(routingFilings).toHaveLength(2);
		expect(routingFilings[0]).toMatchObject({
			id: secondFiling.id,
			status: "rejected",
			reviewNote: "Too aggressive",
		});

		// Out-of-bounds margins are rejected outright.
		const outOfBounds = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					discountPercent: 0,
					marginPercent: 0.9,
				},
				"PUT",
			),
		);
		expect(outOfBounds.status).toBe(400);
	});

	it("publishes only approved Airside discounts across catalogue and detail feeds", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		expect(
			(
				await app.request(
					`/admin/airside/claims/${claim.id}/approve`,
					json(cookie),
				)
			).status,
		).toBe(200);
		const modelId = "airside-discount-model";
		const created = await createModel(cookie, company.id, {
			modelName: modelId,
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(
			(
				await app.request(
					`/admin/airside/filings/${model.pendingFiling.id}/approve`,
					json(cookie),
				)
			).status,
		).toBe(200);

		async function expectDiscount(expected: number) {
			const catalogueResponse = await app.request("/internal/models");
			expect(catalogueResponse.status).toBe(200);
			const catalogue = (await catalogueResponse.json()).models.find(
				(entry: { id: string }) => entry.id === modelId,
			);
			expect(Number(catalogue.mappings[0].discount)).toBeCloseTo(expected);
			const detailsResponse = await app.request(
				`/public/discounts/model/${modelId}`,
			);
			expect(detailsResponse.status).toBe(200);
			const { discounts } = await detailsResponse.json();
			if (expected === 0) {
				expect(discounts).toEqual([]);
			} else {
				expect(discounts).toHaveLength(1);
				expect(discounts[0]).toMatchObject({
					provider: "mistral",
					model: modelId,
				});
				expect(Number(discounts[0].discountPercent)).toBeCloseTo(expected);
			}
			expect(
				Number((await getEffectiveDiscount(null, "mistral", modelId)).discount),
			).toBeCloseTo(expected);
		}

		async function fileDiscount(discountPercent: number, override?: string) {
			const response = await app.request(
				"/airside/routing-settings/mistral",
				json(
					cookie,
					{
						providerCompanyId: company.id,
						modelId: override,
						discountPercent,
						marginPercent: 0.2,
					},
					"PUT",
				),
			);
			expect(response.status).toBe(201);
			return (await response.json()).filing.id as string;
		}

		await expectDiscount(0);
		const carrierFiling = await fileDiscount(0.2);
		await expectDiscount(0);
		expect(
			(
				await app.request(
					`/admin/airside/routing-filings/${carrierFiling}/approve`,
					json(cookie),
				)
			).status,
		).toBe(200);
		await expectDiscount(0.2);
		const override = await fileDiscount(0.3, modelId);
		await expectDiscount(0.2);
		expect(
			(
				await app.request(
					`/admin/airside/routing-filings/${override}/reject`,
					json(cookie, {}),
				)
			).status,
		).toBe(200);
		await expectDiscount(0.2);
		const zero = await fileDiscount(0, modelId);
		expect(
			(
				await app.request(
					`/admin/airside/routing-filings/${zero}/approve`,
					json(cookie),
				)
			).status,
		).toBe(200);
		await expectDiscount(0);
		const restored = await fileDiscount(0.3, modelId);
		expect(
			(
				await app.request(
					`/admin/airside/routing-filings/${restored}/approve`,
					json(cookie),
				)
			).status,
		).toBe(200);
		await expectDiscount(0.3);
		expect(
			(
				await app.request(
					`/admin/airside/claims/${claim.id}/revoke`,
					json(cookie, {}),
				)
			).status,
		).toBe(200);
		const catalogue = await app.request("/internal/models");
		expect(catalogue.status).toBe(200);
		expect(
			(await catalogue.json()).models.some(
				(entry: { id: string }) => entry.id === modelId,
			),
		).toBe(false);
		const details = await app.request(`/public/discounts/model/${modelId}`);
		expect((await details.json()).discounts).toEqual([]);
		expect(
			Number((await getEffectiveDiscount(null, "mistral", modelId)).discount),
		).toBe(0);
	});

	it("applies an approved fare override to one model", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		await setRoutingSettings(company.id, "mistral", 0, 0.2);

		const created = await createModel(cookie, company.id, {
			modelName: "mistral-model-fare",
			displayName: "Mistral Model Fare",
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		const modelApproved = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(modelApproved.status).toBe(200);

		const initial = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const initialSettings = (await initial.json()).settings[0];
		expect(initialSettings).toMatchObject({
			discountPercent: 0,
			marginPercent: 0.2,
		});
		expect(initialSettings.modelOverrides).toEqual([
			expect.objectContaining({
				modelId: "mistral-model-fare",
				discountPercent: 0,
				marginPercent: 0.2,
				overridden: false,
			}),
		]);

		const filed = await app.request(
			"/airside/routing-settings/mistral",
			json(
				cookie,
				{
					providerCompanyId: company.id,
					modelId: "mistral-model-fare",
					discountPercent: 0.1,
					marginPercent: 0.15,
				},
				"PUT",
			),
		);
		expect(filed.status).toBe(201);
		const filing = (await filed.json()).filing;
		expect(filing).toMatchObject({
			modelId: "mistral-model-fare",
			routingAdjustment: expect.closeTo(-0.055),
		});

		const whilePending = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const pendingSettings = (await whilePending.json()).settings[0];
		expect(pendingSettings).toMatchObject({
			discountPercent: 0,
			marginPercent: 0.2,
		});
		expect(pendingSettings.modelOverrides[0]).toMatchObject({
			overridden: false,
			discountPercent: 0,
			marginPercent: 0.2,
			pendingFiling: expect.objectContaining({ id: filing.id }),
		});

		const queue = await app.request("/admin/airside/filings?status=pending", {
			headers: { Cookie: cookie },
		});
		expect((await queue.json()).routingFilings[0]).toMatchObject({
			id: filing.id,
			modelId: "mistral-model-fare",
			currentDiscountPercent: 0,
			currentMarginPercent: 0.2,
		});

		const approved = await app.request(
			`/admin/airside/routing-filings/${filing.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const stored = await db.query.providerRoutingSettings.findFirst({
			where: {
				providerId: { eq: "mistral" },
				modelId: { eq: "mistral-model-fare" },
			},
		});
		expect(Number(stored?.discountPercent)).toBeCloseTo(0.1);
		expect(Number(stored?.marginPercent)).toBeCloseTo(0.15);

		const final = await app.request(
			`/airside/routing-settings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const finalSettings = (await final.json()).settings[0];
		expect(finalSettings).toMatchObject({
			discountPercent: 0,
			marginPercent: 0.2,
		});
		expect(finalSettings.modelOverrides[0]).toMatchObject({
			overridden: true,
			discountPercent: 0.1,
			marginPercent: 0.15,
			routingAdjustment: expect.closeTo(-0.055),
		});
	});

	it("lists every carrier's settings and accrued margin for admins", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		await setRoutingSettings(company.id, "mistral", 0.1, 0.3);

		// Accrued margin comes from the daily global rollups: one day inside the
		// 30-day window, one outside.
		const now = Date.now();
		const dayMs = 24 * 60 * 60 * 1000;
		await db.insert(tables.globalModelStats).values([
			{
				dayTimestamp: new Date(now - 2 * dayMs), // eslint-disable-line no-mixed-operators
				usedModel: "mistral-medium-4",
				usedProvider: "mistral",
				usedMode: "credits",
				orgKind: "default",
				requestCount: 10,
				cost: 20,
				providerMarginAmount: 5,
			},
			{
				dayTimestamp: new Date(now - 2 * dayMs), // eslint-disable-line no-mixed-operators
				usedModel: "mistral-medium-4",
				usedProvider: "mistral",
				usedMode: "api-keys",
				orgKind: "default",
				requestCount: 10,
				cost: 20,
				// Historical BYOK rows may contain margin from the old aggregation
				// formula; admin totals must exclude them defensively.
				providerMarginAmount: 99,
			},
			{
				dayTimestamp: new Date(now - 60 * dayMs), // eslint-disable-line no-mixed-operators
				usedModel: "mistral-medium-4",
				usedProvider: "mistral",
				usedMode: "credits",
				orgKind: "default",
				requestCount: 10,
				cost: 30,
				providerMarginAmount: 7,
			},
		]);

		try {
			const res = await app.request("/admin/airside/routing-settings", {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.providers).toHaveLength(1);
			expect(body.providers[0]).toMatchObject({
				providerId: "mistral",
				company: expect.objectContaining({ name: "Mistral Ops" }),
			});
			expect(body.providers[0].discountPercent).toBeCloseTo(0.1);
			expect(body.providers[0].marginPercent).toBeCloseTo(0.3);
			expect(body.providers[0].routingAdjustment).toBeCloseTo(-0.19);
			expect(body.providers[0].marginAmount30d).toBeCloseTo(5);
			expect(body.providers[0].marginAmountTotal).toBeCloseTo(12);
			// Traffic defaults to a 7-day, UTC-day grid.
			expect(body).toMatchObject({ window: "7d", bucket: "day" });
			expect(body.providers[0].series).toHaveLength(7);
		} finally {
			// deleteAll() does not cover the global stats tables.
			await db
				.delete(tables.globalModelStats)
				.where(eq(tables.globalModelStats.usedProvider, "mistral"));
		}
	});

	it("reports carrier status, mapping counts, and routed traffic per window", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		await setRoutingSettings(company.id, "mistral", 0.1, 0.3);

		const modelId = "carrier-traffic-model";
		const retiredModelId = "carrier-traffic-retired-model";
		const rootId = "carrier-traffic-root";
		const regionalId = "carrier-traffic-region";
		const retiredId = "carrier-traffic-retired";
		const providerExisted = Boolean(
			await db.query.provider.findFirst({ where: { id: { eq: "mistral" } } }),
		);
		if (!providerExisted) {
			await db
				.insert(tables.provider)
				.values({ id: "mistral", name: "Mistral", description: "test" });
		}
		await db.insert(tables.model).values([
			{ id: modelId, name: "Carrier traffic model", family: "test" },
			{ id: retiredModelId, name: "Carrier traffic retired", family: "test" },
		]);
		await db.insert(tables.modelProviderMapping).values([
			{
				id: rootId,
				modelId,
				providerId: "mistral",
				externalId: modelId,
				source: "airside",
			},
			{
				id: regionalId,
				modelId,
				providerId: "mistral",
				externalId: modelId,
				source: "airside",
				region: "eu",
			},
			{
				id: retiredId,
				modelId: retiredModelId,
				providerId: "mistral",
				externalId: retiredModelId,
				source: "airside",
				status: "inactive",
			},
		]);

		const hourMs = 60 * 60 * 1000;
		const recentHour = new Date(
			Math.floor(Date.now() / hourMs) * hourMs - 2 * hourMs, // eslint-disable-line no-mixed-operators
		);
		const olderHour = new Date(recentHour.getTime() - 3 * 24 * hourMs); // eslint-disable-line no-mixed-operators
		const historyIds = ["ct-recent", "ct-recent-region", "ct-older"];
		await db.insert(tables.modelProviderMappingHistoryHourly).values([
			{
				id: historyIds[0],
				modelId,
				providerId: "mistral",
				modelProviderMappingId: rootId,
				hourTimestamp: recentHour,
				logsCount: 10,
				errorsCount: 3,
				clientErrorsCount: 1,
				upstreamErrorsCount: 2,
				totalCost: 4,
			},
			// Regional rows are already merged into the root row.
			{
				id: historyIds[1],
				modelId,
				providerId: "mistral",
				modelProviderMappingId: regionalId,
				hourTimestamp: recentHour,
				logsCount: 10,
				totalCost: 4,
			},
			{
				id: historyIds[2],
				modelId,
				providerId: "mistral",
				modelProviderMappingId: rootId,
				hourTimestamp: olderHour,
				logsCount: 5,
				totalCost: 6,
			},
		]);

		try {
			const [{ catalogueActive }] = await db
				.select({ catalogueActive: sql<number>`count(*)::int` })
				.from(tables.modelProviderMapping)
				.where(
					sql`${tables.modelProviderMapping.providerId} = 'mistral' and ${tables.modelProviderMapping.status} = 'active' and ${tables.modelProviderMapping.region} is null`,
				);

			const day = await app.request(
				"/admin/airside/routing-settings?window=24h",
				{ headers: { Cookie: cookie } },
			);
			expect(day.status).toBe(200);
			const dayBody = await day.json();
			expect(dayBody).toMatchObject({ window: "24h", bucket: "hour" });
			const dayCarrier = dayBody.providers[0];
			expect(dayCarrier).toMatchObject({
				status: "active",
				airsideMappingCount: 1,
				activeMappingCount: catalogueActive,
				requestCount: 10,
				clientErrorCount: 1,
				gatewayErrorCount: 0,
				upstreamErrorCount: 2,
			});
			expect(dayCarrier.routedCost).toBeCloseTo(4);
			expect(dayCarrier.series).toHaveLength(24);
			expect(
				dayCarrier.series.filter((point: { cost: number }) => point.cost > 0),
			).toEqual([
				expect.objectContaining({ date: recentHour.toISOString(), cost: 4 }),
			]);

			const week = await app.request(
				"/admin/airside/routing-settings?window=7d",
				{ headers: { Cookie: cookie } },
			);
			const weekCarrier = (await week.json()).providers[0];
			expect(weekCarrier.routedCost).toBeCloseTo(10);
			expect(weekCarrier.requestCount).toBe(15);
			expect(weekCarrier.series).toHaveLength(7);

			const month = await app.request(
				"/admin/airside/routing-settings?window=30d",
				{ headers: { Cookie: cookie } },
			);
			expect((await month.json()).providers[0].series).toHaveLength(30);
		} finally {
			await db
				.delete(tables.modelProviderMappingHistoryHourly)
				.where(
					inArray(tables.modelProviderMappingHistoryHourly.id, historyIds),
				);
			await db
				.delete(tables.model)
				.where(inArray(tables.model.id, [modelId, retiredModelId]));
			if (!providerExisted) {
				await db
					.delete(tables.provider)
					.where(eq(tables.provider.id, "mistral"));
			}
		}
	});

	it("stores a model's selected upstream API format", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "responses-only-model",
			apiFormat: "openai-responses",
		});
		expect(res.status).toBe(201);
		const { model } = await res.json();
		expect(model.apiFormat).toBe("openai-responses");
		const stored = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: model.id } },
		});
		expect(stored?.apiFormat).toBe("openai-responses");
	});

	it("stores reasoning efforts and audio on a listing", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "mistral-reasoner-x",
			reasoning: true,
			audio: true,
			reasoningEfforts: ["low", "medium", "high"],
		});
		expect(res.status).toBe(201);
		const { model } = await res.json();
		expect(model.audio).toBe(true);
		expect(model.reasoningEfforts).toEqual(["low", "medium", "high"]);

		// Edits to the efforts persist.
		await passPreflight(model.id);
		const patch = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { reasoningEfforts: ["medium", "max"] }, "PATCH"),
		);
		expect(patch.status).toBe(200);
		expect((await patch.json()).model.reasoningEfforts).toEqual([
			"medium",
			"max",
		]);
		const stored = await db.query.providerDraftModel.findFirst({
			where: { id: { eq: model.id } },
		});
		expect(stored?.reasoningEfforts).toEqual(["medium", "max"]);

		// Materialization carries the efforts onto the catalogue mapping.
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		const filings = await app.request(
			`/airside/filings?providerCompanyId=${company.id}`,
			{ headers: { Cookie: cookie } },
		);
		const filing = (await filings.json()).filings.find(
			(f: { status: string }) => f.status === "pending",
		);
		const approve = await app.request(
			`/admin/airside/filings/${filing.id}/approve`,
			json(cookie),
		);
		expect(approve.status).toBe(200);
		const mapping = await db.query.modelProviderMapping.findFirst({
			where: { modelId: { eq: "mistral-reasoner-x" } },
		});
		// The patched efforts (not the original ones) are what materialize.
		expect(mapping?.reasoningEfforts).toEqual(["medium", "max"]);
	});

	it("files branding edits on a live claim for review", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		await activateClaim();

		const svg = `data:image/svg+xml;base64,${"B".repeat(64)}`;
		const res = await app.request(
			`/airside/claims/${claim.id}`,
			json(
				cookie,
				{ logoUrl: svg, customBaseUrl: "https://evil.example" },
				"PATCH",
			),
		);
		expect(res.status).toBe(200);
		const filed = (await res.json()).claim;
		// Live branding waits for review; the API endpoint stays fixed.
		expect(filed.logoUrl).toBeNull();
		expect(filed.pendingBranding).toEqual({ logoUrl: svg });
		expect(filed.customBaseUrl).toBeNull();
		const rejected = await app.request(
			`/airside/claims/${claim.id}/branding/reject`.replace(
				"/airside/",
				"/admin/airside/",
			),
			json(cookie),
		);
		expect(rejected.status).toBe(200);
		expect((await rejected.json()).claim.pendingBranding).toBeNull();
		await app.request(
			`/airside/claims/${claim.id}`,
			json(cookie, { logoUrl: svg }, "PATCH"),
		);
		const approved = await app.request(
			`/admin/airside/claims/${claim.id}/branding/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const updated = (await approved.json()).claim;
		expect(updated.logoUrl).toBe(svg);
		expect(updated.pendingBranding).toBeNull();

		// Non-SVG branding is rejected; null clears the logo.
		const png = await app.request(
			`/airside/claims/${claim.id}`,
			json(
				cookie,
				{ logoUrl: `data:image/png;base64,${"B".repeat(64)}` },
				"PATCH",
			),
		);
		expect(png.status).toBe(400);
		const cleared = await app.request(
			`/airside/claims/${claim.id}`,
			json(cookie, { logoUrl: null }, "PATCH"),
		);
		expect((await cleared.json()).claim.pendingBranding).toEqual({
			logoUrl: null,
		});
		await app.request(
			`/admin/airside/claims/${claim.id}/branding/approve`,
			json(cookie),
		);
		const claims = await app.request("/admin/airside/claims?status=active", {
			headers: { Cookie: cookie },
		});
		const live = (await claims.json()).claims.find(
			(entry: { id: string }) => entry.id === claim.id,
		);
		expect(live).toMatchObject({ logoUrl: null, pendingBranding: null });
	});

	it.each(["catalogue", "custom"])(
		"requires admin approval to rename a %s carrier",
		async (kind) => {
			const email = kind === "custom" ? "ops@acme-sky.ai" : "ops@mistral.ai";
			await setUserEmail(email);
			const company = await createCompany(cookie);
			const claim =
				kind === "custom"
					? (await (await registerCarrier(cookie, company.id)).json()).claim
					: await claimProvider(cookie, company.id);
			await db
				.insert(tables.provider)
				.values({
					id: claim.providerId,
					name: kind === "custom" ? "Acme Sky" : "Mistral AI",
					description: "",
				})
				.onConflictDoNothing();
			await activateClaim(claim.providerId);
			const currentName = kind === "custom" ? "Acme Sky" : "Mistral AI";
			const name = "Updated Carrier";
			const publicName = async () => {
				const response = await app.request("/internal/providers");
				return (await response.json()).providers.find(
					(provider: { id: string }) => provider.id === claim.providerId,
				)?.name;
			};
			const file = () =>
				app.request(
					`/airside/claims/${claim.id}`,
					json(cookie, { name: `  ${name}  ` }, "PATCH"),
				);
			const filed = await file();
			expect(filed.status).toBe(200);
			expect((await filed.json()).claim).toMatchObject({
				providerId: claim.providerId,
				providerName: currentName,
				pendingBranding: { name },
			});
			expect(await publicName()).toBe(currentName);
			const approve = () =>
				app.request(
					`/admin/airside/claims/${claim.id}/branding/approve`,
					json(cookie),
				);
			expect((await approve()).status).toBe(403);
			expect(await publicName()).toBe(currentName);
			process.env.ADMIN_FULL_ACCESS_EMAILS = email;
			const rejected = await app.request(
				`/admin/airside/claims/${claim.id}/branding/reject`,
				json(cookie),
			);
			expect(rejected.status).toBe(200);
			expect((await rejected.json()).claim.pendingBranding).toBeNull();
			expect(await publicName()).toBe(currentName);
			await file();
			const approved = await approve();
			expect(approved.status).toBe(200);
			expect((await approved.json()).claim).toMatchObject({
				providerId: claim.providerId,
				providerName: name,
				pendingBranding: null,
			});
			expect(await publicName()).toBe(name);
			const companies = await app.request("/airside/companies", {
				headers: { Cookie: cookie },
			});
			expect((await companies.json()).companies[0].claims[0].providerName).toBe(
				name,
			);
			const invalid = await app.request(
				`/airside/claims/${claim.id}`,
				json(cookie, { name: "  " }, "PATCH"),
			);
			expect(invalid.status).toBe(400);
		},
	);

	it("includes a pending carrier rename in its initial approval", async () => {
		await setUserEmail("ops@acme-sky.ai");
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@acme-sky.ai";
		const company = await createCompany(cookie);
		const registered = await registerCarrier(cookie, company.id);
		const { claim } = await registered.json();
		const renamed = await app.request(
			`/airside/claims/${claim.id}`,
			json(cookie, { name: "Updated Carrier" }, "PATCH"),
		);
		expect(renamed.status).toBe(200);
		expect((await renamed.json()).claim).toMatchObject({
			status: "pending",
			providerName: "Updated Carrier",
			pendingBranding: null,
		});
		const approved = await app.request(
			`/admin/airside/claims/${claim.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const provider = await db.query.provider.findFirst({
			where: { id: { eq: claim.providerId } },
		});
		expect(provider?.name).toBe("Updated Carrier");
	});

	it("carries cache and per-request pricing through filings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();
		const res = await createModel(cookie, company.id, {
			modelName: "mistral-cached-x",
			pricing: {
				inputPrice: "2e-6",
				outputPrice: "6e-6",
				cachedInputPrice: "5e-7",
				requestPrice: "0.002",
			},
		});
		expect(res.status).toBe(201);
		const { model } = await res.json();
		expect(model.pendingFiling).toMatchObject({
			cachedInputPrice: "5e-7",
			requestPrice: "0.002",
		});
	});

	it("imports catalogue models as managed listings", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		const res = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.imported.length).toBeGreaterThan(0);
		expect(body.imported).toContain("mistral-large-latest");

		// Imported listings are active with the current price as an approved
		// filing, and from then on serve the pair in place of the static
		// catalogue mapping.
		const row = await db.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: "mistral" },
				modelName: { eq: "mistral-large-latest" },
			},
			with: { priceFilings: true },
		});
		expect(row?.status).toBe("active");
		const approved = row?.priceFilings?.find(
			(f: { status: string }) => f.status === "approved",
		);
		expect(approved?.reviewNote).toBe("Imported from the catalogue");
		const canonicalMapping = await db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: "mistral-large-latest" },
				providerId: { eq: "mistral" },
				region: { isNull: true },
			},
		});
		expect(canonicalMapping?.source).toBe("airside");

		// Catalogue-only fields travel with the listing into its mapping.
		expect(body.imported).toContain("glm-5.3");
		const glmListing = await db.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: "mistral" },
				modelName: { eq: "glm-5.3" },
			},
		});
		expect(glmListing?.catalogueMetadata).toMatchObject({ maxTemperature: 1 });
		const glmMapping = await db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: "glm-5.3" },
				providerId: { eq: "mistral" },
				region: { isNull: true },
			},
		});
		expect(glmMapping).toMatchObject({ source: "airside", maxTemperature: 1 });

		// Re-importing skips everything already listed.
		const again = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		const secondBody = await again.json();
		expect(secondBody.imported).toEqual([]);
		expect(secondBody.skipped).toContain("mistral-large-latest");
	});

	it("keeps a delisted catalogue listing out of service until it is relisted", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		const claim = await claimProvider(cookie, company.id);
		await activateClaim();
		await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		const listing = await db.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: "mistral" },
				modelName: { eq: "mistral-large-latest" },
			},
		});
		const canonicalMapping = async () =>
			await db.query.modelProviderMapping.findFirst({
				where: {
					modelId: { eq: "mistral-large-latest" },
					providerId: { eq: "mistral" },
					region: { isNull: true },
				},
			});
		const publicModel = async () => {
			const { models } = await (await app.request("/internal/models")).json();
			const model = models.find(
				(entry: { id: string }) => entry.id === "mistral-large-latest",
			);
			return {
				listed: model.mappings.some(
					(entry: { providerId: string }) => entry.providerId === "mistral",
				) as boolean,
				unlistedProviderIds: model.unlistedProviderIds as string[],
			};
		};
		expect(await publicModel()).toEqual({
			listed: true,
			unlistedProviderIds: [],
		});

		// The static catalogue also maps this pair. The carrier still owns it
		// after a delist, so the hardcoded mapping must not take over.
		const delisted = await app.request(`/airside/models/${listing!.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(delisted.status).toBe(200);
		expect(await canonicalMapping()).toMatchObject({
			source: "airside",
			status: "inactive",
		});
		expect(await publicModel()).toEqual({
			listed: false,
			unlistedProviderIds: ["mistral"],
		});

		await passPreflight(listing!.id);
		const relisted = await app.request(
			`/airside/models/${listing!.id}/relist`,
			json(cookie),
		);
		expect(relisted.status).toBe(200);
		expect(await canonicalMapping()).toMatchObject({
			source: "airside",
			status: "active",
		});
		expect(await publicModel()).toEqual({
			listed: true,
			unlistedProviderIds: [],
		});

		// A paused listing is out of service the same way.
		await app.request(`/airside/models/${listing!.id}/pause`, json(cookie));
		expect(await publicModel()).toEqual({
			listed: false,
			unlistedProviderIds: ["mistral"],
		});
		await app.request(`/airside/models/${listing!.id}/resume`, json(cookie));
		expect((await publicModel()).listed).toBe(true);

		// Losing the provider hands every pair back to the static catalogue,
		// including one the carrier had delisted itself.
		await app.request(`/airside/models/${listing!.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		const revoked = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, { reviewNote: "Ownership dispute" }),
		);
		expect(revoked.status).toBe(200);
		expect(await canonicalMapping()).toMatchObject({
			source: "catalogue",
			status: "active",
			externalId: "mistral-large-latest",
		});
		expect(await publicModel()).toEqual({
			listed: true,
			unlistedProviderIds: [],
		});
		expect(
			await db.query.modelProviderMapping.findFirst({
				where: { providerId: { eq: "mistral" }, source: { eq: "airside" } },
			}),
		).toBeFalsy();
	});

	it("preserves imported quantization and restores it once the claim is revoked", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@deepinfra.com";
		await setUserEmail("ops@deepinfra.com");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id, "deepinfra");
		await activateClaim("deepinfra");
		const imported = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "deepinfra" }),
		);
		expect(imported.status).toBe(200);
		const listing = await db.query.providerDraftModel.findFirst({
			where: {
				providerId: { eq: "deepinfra" },
				quantization: { isNotNull: true },
			},
		});
		expect(listing).toBeDefined();
		const publicQuantization = async () => {
			const { models } = await (await app.request("/internal/models")).json();
			return models
				.find((entry: { id: string }) => entry.id === listing!.modelName)
				.mappings.find(
					(entry: { providerId: string }) => entry.providerId === "deepinfra",
				)?.quantization;
		};
		expect(await publicQuantization()).toBe(listing!.quantization);
		const changed = await app.request(
			`/airside/models/${listing!.id}`,
			json(cookie, { quantization: null }, "PATCH"),
		);
		const { model } = await changed.json();
		const approved = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		expect(await publicQuantization()).toBeNull();
		const delisted = await app.request(`/airside/models/${listing!.id}`, {
			method: "DELETE",
			headers: { Cookie: cookie },
		});
		expect(delisted.status).toBe(200);
		expect(await publicQuantization()).toBeUndefined();
		const claim = await db.query.providerClaim.findFirst({
			where: { providerId: { eq: "deepinfra" } },
		});
		const revoked = await app.request(
			`/admin/airside/claims/${claim!.id}/revoke`,
			json(cookie, { reviewNote: "Ownership dispute" }),
		);
		expect(revoked.status).toBe(200);
		expect(await publicQuantization()).toBe(listing!.quantization);
	});

	it("preserves catalogue upstream IDs during import", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@groq.com";
		await setUserEmail("ops@groq.com");
		const company = await createCompany(cookie, "Groq Ops");
		await claimProvider(cookie, company.id, "groq");
		await activateClaim("groq");

		const res = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "groq" }),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).imported).toContain("gpt-oss-120b");

		const mapping = await db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: "gpt-oss-120b" },
				providerId: { eq: "groq" },
				region: { isNull: true },
			},
		});
		expect(mapping).toMatchObject({
			externalId: "openai/gpt-oss-120b",
			source: "airside",
		});

		const listing = await db.query.providerDraftModel.findFirst({
			where: {
				modelName: { eq: "gpt-oss-120b" },
				providerId: { eq: "groq" },
			},
		});
		const filed = await app.request(
			`/airside/models/${listing!.id}/price-filings`,
			json(cookie, { inputPrice: "0.2e-6", outputPrice: "0.8e-6" }),
		);
		const filing = (await filed.json()).filing;
		const approved = await app.request(
			`/admin/airside/filings/${filing.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const repriced = await db.query.modelProviderMapping.findFirst({
			where: { id: { eq: mapping!.id } },
		});
		expect(repriced?.externalId).toBe("openai/gpt-oss-120b");
		expect(Number(repriced?.inputPrice)).toBeCloseTo(0.2e-6);
	});

	it("materializes the registered upstream id, not the retired one", async () => {
		// The carrier states the id its API serves; the retired catalogue
		// deployment's upstream id must not leak into the new listing.
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@groq.com";
		await setUserEmail("ops@groq.com");
		const company = await createCompany(cookie, "Groq Ops");
		await claimProvider(cookie, company.id, "groq");
		await activateClaim("groq");
		const now = new Date();
		const retired = (catalogueModels as readonly ModelDefinition[]).find(
			(model) => {
				const groq = model.providers.filter((p) => p.providerId === "groq");
				return (
					groq.length > 0 &&
					groq.every(
						(p) =>
							p.deactivatedAt && p.deactivatedAt <= now && !p.regions?.length,
					) &&
					groq[0].externalId !== model.id
				);
			},
		);
		expect(retired).toBeTruthy();

		const created = await createModel(cookie, company.id, {
			providerId: "groq",
			modelName: retired!.id,
			externalId: `${retired!.id}-2026`,
			displayName: retired!.name ?? retired!.id,
		});
		expect(created.status).toBe(201);
		const { model } = await created.json();
		expect(model.externalId).toBe(`${retired!.id}-2026`);
		const approved = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);

		const mapping = await db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: retired!.id },
				providerId: { eq: "groq" },
				region: { isNull: true },
			},
		});
		expect(mapping).toMatchObject({
			source: "airside",
			externalId: `${retired!.id}-2026`,
		});
	});

	it("skips catalogue mappings a flat listing cannot represent", async () => {
		// A listing carries one price pair. Importing a mapping with
		// context-length bands or per-region rates would bill everything
		// outside the base band at the wrong rate, so those stay behind.
		await setUserEmail("ops@alibabacloud.com");
		const company = await createCompany(cookie, "Alibaba Cloud");
		await claimProvider(cookie, company.id, "alibaba");
		await activateClaim("alibaba");

		const res = await app.request(
			"/airside/models/import",
			json(cookie, { providerCompanyId: company.id, providerId: "alibaba" }),
		);
		expect(res.status).toBe(200);
		const { imported, skipped } = await res.json();
		// qwen-max is banded by input length; qwen-image-plus is a flat mapping.
		expect(skipped).toContain("qwen-max");
		expect(imported).not.toContain("qwen-max");
		expect(imported).toContain("qwen-image-plus");
	});

	it("round-trips the carrier rate limit scope", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);
		await activateClaim();

		// Defaults to one shared counter — what a carrier means by "my
		// deployment takes 60 rpm".
		const created = await createModel(cookie, company.id, { maxRpm: 60 });
		const { model } = await created.json();
		expect(model.rateLimitScope).toBe("global");

		const patched = await app.request(
			`/airside/models/${model.id}`,
			json(cookie, { rateLimitScope: "per_org" }, "PATCH"),
		);
		expect(patched.status).toBe(200);
		expect((await patched.json()).model.rateLimitScope).toBe("per_org");
	});

	async function registerCarrier(
		testCookie: string,
		providerCompanyId: string,
		overrides: Record<string, unknown> = {},
	) {
		return await app.request(
			"/airside/carriers",
			json(testCookie, {
				providerCompanyId,
				providerId: "acme-sky",
				name: "Acme Sky",
				baseUrl: "https://api.acme-sky.ai",
				profile: carrierProfile,
				...overrides,
			}),
		);
	}

	it("verifies the website's domain over DNS and accepts it as a claim domain", async () => {
		// A freemail account proves nothing on its own, so this account can
		// only register a carrier once it proves the company's domain.
		await setUserEmail("founder@gmail.com");
		const create = await app.request(
			"/airside/companies",
			json(cookie, {
				name: "Acme Sky",
				website: "https://acme-sky.ai",
				acceptTerms: true,
			}),
		);
		const company = (await create.json()).company as { id: string };

		const blocked = await registerCarrier(cookie, company.id);
		expect(blocked.status).toBe(403);

		// Registering the company queues its website's domain for verification.
		const challenge = await app.request(
			`/airside/companies/${company.id}/domains`,
			{ headers: { Cookie: cookie } },
		);
		expect(challenge.status).toBe(200);
		const record = await challenge.json();
		expect(record.recordName).toBe("_llmgateway-airside");
		expect(record.recordValue).toMatch(
			/^llmgateway-airside-verification=[0-9a-f]{32}$/,
		);
		expect(record.suggestedDomain).toBeNull();
		expect(record.domains).toHaveLength(1);
		const [domain] = record.domains;
		expect(domain.domain).toBe("acme-sky.ai");
		expect(domain.verifiedAt).toBeNull();

		// Nothing published yet.
		txtRecords.clear();
		const tooEarly = await app.request(
			`/airside/companies/${company.id}/domains/${domain.id}/verify`,
			json(cookie),
		);
		expect(tooEarly.status).toBe(400);

		txtRecords.set("_llmgateway-airside.acme-sky.ai", [
			[record.recordValue as string],
		]);
		const verified = await app.request(
			`/airside/companies/${company.id}/domains/${domain.id}/verify`,
			json(cookie),
		);
		expect(verified.status).toBe(200);
		expect((await verified.json()).domain.verifiedAt).not.toBeNull();

		// The proven domain now carries a registration the email domain could not.
		const allowed = await registerCarrier(cookie, company.id);
		expect(allowed.status).toBe(201);
		expect((await allowed.json()).claim.matchedDomain).toBe("acme-sky.ai");
	});

	it("requires the core public profile to register a carrier", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");

		const noProfile = await registerCarrier(cookie, company.id, {
			profile: undefined,
		});
		expect(noProfile.status).toBe(400);
		const partial = await registerCarrier(cookie, company.id, {
			profile: { website: "https://acme-sky.ai" },
		});
		expect(partial.status).toBe(400);
		expect(JSON.stringify(await partial.json())).toContain(
			"privacy policy URL",
		);
		const ftp = await registerCarrier(cookie, company.id, {
			profile: { ...carrierProfile, termsUrl: "ftp://acme-sky.ai/terms" },
		});
		expect(ftp.status).toBe(400);

		const created = await registerCarrier(cookie, company.id, {
			profile: {
				...carrierProfile,
				headquarters: "DE",
				apiTraining: false,
				soc2: 2,
			},
		});
		expect(created.status).toBe(201);
		const { claim } = await created.json();
		expect(claim.profile).toMatchObject({
			...carrierProfile,
			headquarters: "DE",
			apiTraining: false,
			soc2: 2,
			statusPageUrl: null,
		});
		expect(claim.profileMissing).toEqual([]);
		expect(claim.profileRecommendedMissing).toContain("statusPageUrl");
		expect(claim.profileUpdatedAt).not.toBeNull();
		const row = await db.query.providerClaim.findFirst({
			where: { id: { eq: claim.id } },
		});
		expect(row).toMatchObject({
			privacyPolicyUrl: carrierProfile.privacyPolicyUrl,
			termsUrl: carrierProfile.termsUrl,
			headquarters: "DE",
			soc2: 2,
		});
	});

	it("updates a claim's public profile in place", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const { claim } = await (await registerCarrier(cookie, company.id)).json();
		const patch = async (body: Record<string, unknown>) =>
			await app.request(
				`/airside/claims/${claim.id}/profile`,
				json(cookie, body, "PATCH"),
			);

		const updated = await patch({
			statusPageUrl: "https://status.acme-sky.ai",
			retentionPeriod: "30 days",
			gdpr: true,
		});
		expect(updated.status).toBe(200);
		const body = await updated.json();
		expect(body.claim.profile).toMatchObject({
			statusPageUrl: "https://status.acme-sky.ai",
			retentionPeriod: "30 days",
			gdpr: true,
			website: carrierProfile.website,
		});
		expect(body.claim.profileRecommendedMissing).not.toContain("statusPageUrl");

		// Optional fields clear with null; required ones cannot.
		const cleared = await patch({ statusPageUrl: null });
		expect((await cleared.json()).claim.profile.statusPageUrl).toBeNull();
		expect((await patch({ termsUrl: null })).status).toBe(400);
		expect((await patch({ website: "not a url" })).status).toBe(400);
		expect((await patch({ headquarters: "Germany" })).status).toBe(400);
		expect((await patch({ soc2: 3 })).status).toBe(400);

		// Live claims apply profile changes immediately, with no review.
		await activateClaim("acme-sky");
		const live = await patch({ legalEntity: "Acme Sky GmbH" });
		expect(live.status).toBe(200);
		const liveClaim = (await live.json()).claim;
		expect(liveClaim.profile.legalEntity).toBe("Acme Sky GmbH");
		expect(liveClaim.pendingBranding).toBeNull();

		const other = await createSecondUser("other@example.com");
		const foreign = await app.request(
			`/airside/claims/${claim.id}/profile`,
			json(other, { gdpr: false }, "PATCH"),
		);
		expect(foreign.status).toBe(404);

		await db
			.update(tables.providerClaim)
			.set({ status: "rejected" })
			.where(eq(tables.providerClaim.id, claim.id));
		expect((await patch({ gdpr: false })).status).toBe(409);
	});

	it("publishes a live custom carrier's profile on the provider listing", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const registered = await registerCarrier(cookie, company.id, {
			profile: { ...carrierProfile, soc2: 0, headquarters: "FR" },
		});
		expect(registered.status).toBe(201);
		await db
			.insert(tables.provider)
			.values({ id: "acme-sky", name: "Acme Sky", description: "" })
			.onConflictDoNothing();
		const listed = async () =>
			(await (await app.request("/internal/providers")).json()).providers.find(
				(p: { id: string }) => p.id === "acme-sky",
			);

		// Pending registrations publish nothing.
		expect((await listed()).airsideProfile).toBeNull();
		await activateClaim("acme-sky");
		expect((await listed()).airsideProfile).toEqual({
			website: carrierProfile.website,
			statusPageUrl: null,
			termsUrl: carrierProfile.termsUrl,
			privacyPolicyUrl: carrierProfile.privacyPolicyUrl,
			legalEntity: null,
			headquarters: "FR",
			dataPolicy: {
				apiTraining: null,
				promptLogging: null,
				retentionPeriod: null,
				gdpr: null,
				soc2: 0,
				iso27001: null,
			},
		});
	});

	it("reports missing profile fields on legacy custom claims", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		await db.insert(tables.providerClaim).values({
			providerCompanyId: company.id,
			providerId: "acme-sky",
			kind: "custom",
			matchedDomain: "acme-sky.ai",
			customName: "Acme Sky",
			customBaseUrl: "https://api.acme-sky.ai",
			status: "active",
		});
		const res = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		const [claim] = (await res.json()).companies[0].claims;
		expect(claim.profileMissing).toEqual([
			"website",
			"privacyPolicyUrl",
			"termsUrl",
		]);
		expect(claim.profileUpdatedAt).toBeNull();
		expect(claim.profile.website).toBeNull();
	});

	it("suggests the website's domain and keeps a proof when the website moves", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const domainsUrl = `/airside/companies/${company.id}/domains`;
		const list = async () =>
			await (
				await app.request(domainsUrl, { headers: { Cookie: cookie } })
			).json();

		// A company without a row for its website gets the domain suggested.
		const [queued] = (await list()).domains;
		await app.request(
			`${domainsUrl}/${queued.id}`,
			json(cookie, undefined, "DELETE"),
		);
		const emptied = await list();
		expect(emptied.domains).toEqual([]);
		expect(emptied.suggestedDomain).toBe("mistral.ai");

		const added = await app.request(
			domainsUrl,
			json(cookie, { domain: emptied.suggestedDomain }),
		);
		expect(added.status).toBe(201);
		const { domain } = await added.json();
		expect((await list()).suggestedDomain).toBeNull();

		txtRecords.set("_llmgateway-airside.mistral.ai", [
			[emptied.recordValue as string],
		]);
		await app.request(`${domainsUrl}/${domain.id}/verify`, json(cookie));

		// The proof belongs to the domain, not to the website field.
		await db
			.update(tables.providerCompany)
			.set({ website: "https://somewhere-else.ai" })
			.where(eq(tables.providerCompany.id, company.id));
		const after = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		const [listed] = (await after.json()).companies;
		expect(listed.verifiedDomains).toEqual(["mistral.ai"]);
	});

	it("verifies an additional domain and accepts carriers hosted on it", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const offDomain = { baseUrl: "https://flash.acme-sky.cloud" };
		expect((await registerCarrier(cookie, company.id, offDomain)).status).toBe(
			403,
		);

		// A URL or subdomain collapses to the registrable domain.
		const added = await app.request(
			`/airside/companies/${company.id}/domains`,
			json(cookie, { domain: "https://Flash.acme-sky.cloud/v1" }),
		);
		expect(added.status).toBe(201);
		const { domain } = await added.json();
		expect(domain.domain).toBe("acme-sky.cloud");
		expect(domain.verifiedAt).toBeNull();

		const dupe = await app.request(
			`/airside/companies/${company.id}/domains`,
			json(cookie, { domain: "acme-sky.cloud" }),
		);
		expect(dupe.status).toBe(409);

		// Added but unproven: still not claimable.
		txtRecords.clear();
		const tooEarly = await app.request(
			`/airside/companies/${company.id}/domains/${domain.id}/verify`,
			json(cookie),
		);
		expect(tooEarly.status).toBe(400);
		expect((await registerCarrier(cookie, company.id, offDomain)).status).toBe(
			403,
		);

		const listed = await (
			await app.request(`/airside/companies/${company.id}/domains`, {
				headers: { Cookie: cookie },
			})
		).json();
		expect(listed.domains.map((d: { domain: string }) => d.domain)).toEqual([
			"mistral.ai",
			"acme-sky.cloud",
		]);
		txtRecords.set("_llmgateway-airside.acme-sky.cloud", [
			[listed.recordValue as string],
		]);
		const verified = await app.request(
			`/airside/companies/${company.id}/domains/${domain.id}/verify`,
			json(cookie),
		);
		expect(verified.status).toBe(200);
		expect((await verified.json()).domain.verifiedAt).not.toBeNull();

		const companies = await (
			await app.request("/airside/companies", { headers: { Cookie: cookie } })
		).json();
		expect(companies.companies[0].verifiedDomains).toEqual(["acme-sky.cloud"]);

		const allowed = await registerCarrier(cookie, company.id, offDomain);
		expect(allowed.status).toBe(201);
		expect((await allowed.json()).claim.matchedDomain).toBe("acme-sky.cloud");

		// Removing the domain withdraws it from future registrations.
		const removed = await app.request(
			`/airside/companies/${company.id}/domains/${domain.id}`,
			json(cookie, undefined, "DELETE"),
		);
		expect(removed.status).toBe(200);
		expect(
			(
				await registerCarrier(cookie, company.id, {
					...offDomain,
					providerId: "acme-sky-two",
				})
			).status,
		).toBe(403);
	});

	it("rejects unusable domains", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		for (const domain of ["localhost", "10.0.0.1", "gmail.com"]) {
			const res = await app.request(
				`/airside/companies/${company.id}/domains`,
				json(cookie, { domain }),
			);
			expect(res.status).toBe(400);
		}
		const foreign = await app.request(
			"/airside/companies/not-a-company/domains",
			json(cookie, { domain: "acme-sky.cloud" }),
		);
		expect(foreign.status).toBe(404);
	});

	it("registers a new carrier as a pending custom claim", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const res = await registerCarrier(cookie, company.id, {
			description: "Regional AI carrier",
		});
		expect(res.status).toBe(201);
		const { claim } = await res.json();
		expect(claim.kind).toBe("custom");
		expect(claim.status).toBe("pending");
		expect(claim.providerId).toBe("acme-sky");
		expect(claim.providerName).toBe("Acme Sky");
		expect(claim.customBaseUrl).toBe("https://api.acme-sky.ai");

		// Pending registration blocks the id for everyone.
		const dupe = await registerCarrier(cookie, company.id);
		expect(dupe.status).toBe(409);
	});

	// Upstream for custom-carrier smoke tests: answers a basic completion for
	// the keys in `workingKeys`, 401 for anything else.
	function stubCarrierUpstream(workingKeys: Set<string>) {
		const upstream = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				const token = new Headers(init?.headers).get("authorization");
				return token && workingKeys.has(token.replace("Bearer ", ""))
					? Response.json({
							id: "chatcmpl-1",
							object: "chat.completion",
							model: "sky",
							choices: [
								{
									index: 0,
									message: { role: "assistant", content: "OK" },
									finish_reason: "stop",
								},
							],
						})
					: Response.json(
							{ error: { message: "Invalid API key" } },
							{ status: 401 },
						);
			},
		);
		vi.stubGlobal("fetch", upstream);
		return upstream;
	}

	async function approvedCarrier() {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@acme-sky.ai";
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const { claim } = await (await registerCarrier(cookie, company.id)).json();
		await app.request(
			`/admin/airside/claims/${claim.id}/approve`,
			json(cookie),
		);
		// The testing key preflight runs on, saved like any pasted one.
		await app.request(
			`/airside/claims/${claim.id}/verification-key`,
			json(cookie, { apiKey: "sk-acme-sky-testing-key" }, "PUT"),
		);
		return { company, claim: claim as { id: string } };
	}

	const sky = (modelName: string, providerKey?: string) => ({
		providerId: "acme-sky",
		modelName,
		...(providerKey ? { providerKey } : {}),
	});

	it("files the provider key with the first model and serves it once approved", async () => {
		const { company, claim } = await approvedCarrier();
		// Registration and approval collect no provider key.
		expect(
			await db.query.providerKey.findMany({
				where: { provider: { eq: "acme-sky" } },
			}),
		).toHaveLength(0);
		const upstream = stubCarrierUpstream(new Set(["sk-acme-sky-serving-key"]));

		const missing = await createModel(cookie, company.id, sky("sky-large"));
		expect(missing.status).toBe(400);
		expect((await missing.json()).message).toContain("Add your provider key");
		const sameAsTesting = await createModel(
			cookie,
			company.id,
			sky("sky-large", "sk-acme-sky-testing-key"),
		);
		expect(sameAsTesting.status).toBe(400);
		expect((await sameAsTesting.json()).message).toContain(
			"two different keys",
		);
		const broken = await createModel(
			cookie,
			company.id,
			sky("sky-large", "sk-acme-sky-broken"),
		);
		expect(broken.status).toBe(400);
		const brokenBody = await broken.json();
		expect(brokenBody.message).toContain("smoke test against sky-large");
		expect(brokenBody.message).not.toContain("sk-acme-sky-broken");
		expect(
			await db.query.providerKey.findMany({
				where: { provider: { eq: "acme-sky" } },
			}),
		).toHaveLength(0);

		const first = await createModel(
			cookie,
			company.id,
			sky("sky-large", "sk-acme-sky-serving-key"),
		);
		expect(first.status).toBe(201);
		const [url] = upstream.mock.calls.at(-1)!;
		expect(String(url)).toBe("https://api.acme-sky.ai/v1/chat/completions");
		const [key] = await db.query.providerKey.findMany({
			where: { provider: { eq: "acme-sky" } },
		});
		expect(key).toMatchObject({
			managed: true,
			organizationId: null,
			status: "inactive",
		});
		expect(key.tokenCiphertext).not.toContain("sk-acme-sky-serving-key");
		expect(readProviderKey(key)).toBe("sk-acme-sky-serving-key");

		// The first key is reviewed with the first model: it cannot be dropped.
		expect(
			(
				await app.request(
					`/airside/claims/${claim.id}/provider-key`,
					json(cookie, undefined, "DELETE"),
				)
			).status,
		).toBe(409);
		expect(
			(
				await app.request(
					`/admin/airside/claims/${claim.id}/provider-key/reject`,
					json(cookie),
				)
			).status,
		).toBe(409);

		// Later models probe the key on file instead of taking another one.
		const extraKey = await createModel(
			cookie,
			company.id,
			sky("sky-small", "sk-acme-sky-other"),
		);
		expect(extraKey.status).toBe(400);
		expect((await extraKey.json()).message).toContain("already on file");
		expect(
			(await createModel(cookie, company.id, sky("sky-small"))).status,
		).toBe(201);

		// Approving the first model puts its provider key into service.
		const { model } = await first.json();
		const approved = await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const live = await db.query.providerKey.findFirst({
			where: { id: { eq: key.id } },
		});
		expect(live?.status).toBe("active");
		const liveClaim = await db.query.providerClaim.findFirst({
			where: { id: { eq: claim.id } },
		});
		expect(liveClaim).toMatchObject({
			providerKeyId: key.id,
			pendingProviderKeyId: null,
		});

		// Revoking the carrier retires its key.
		const revoked = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, {}),
		);
		expect(revoked.status).toBe(200);
		const retired = await db.query.providerKey.findFirst({
			where: { id: { eq: key.id } },
		});
		expect(retired?.status).toBe("deleted");
	});

	it("replaces the provider key only after a smoke test and admin approval", async () => {
		const { company, claim } = await approvedCarrier();
		const workingKeys = new Set(["sk-acme-sky-serving-key"]);
		stubCarrierUpstream(workingKeys);
		const submit = async (apiKey: string) =>
			await app.request(
				`/airside/claims/${claim.id}/provider-key`,
				json(cookie, { apiKey }, "PUT"),
			);

		// Before any listing there is nothing to smoke-test against.
		const early = await submit("sk-acme-sky-early");
		expect(early.status).toBe(409);
		expect((await early.json()).message).toContain("first model");

		const first = await createModel(
			cookie,
			company.id,
			sky("sky-large", "sk-acme-sky-serving-key"),
		);
		const { model } = await first.json();
		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);
		const original = await db.query.providerKey.findFirst({
			where: { provider: { eq: "acme-sky" } },
		});

		// The testing key and the live key are not valid replacements.
		expect((await submit("sk-acme-sky-testing-key")).status).toBe(400);
		expect((await submit("sk-acme-sky-serving-key")).status).toBe(400);
		// Nor can the testing key become the provider key the other way round.
		const sameTestingKey = await app.request(
			`/airside/claims/${claim.id}/verification-key`,
			json(cookie, { apiKey: "sk-acme-sky-serving-key" }, "PUT"),
		);
		expect(sameTestingKey.status).toBe(400);
		// A key that fails the smoke test never reaches review.
		const broken = await submit("sk-acme-sky-broken");
		expect(broken.status).toBe(400);
		expect((await broken.json()).message).toContain("smoke test");

		for (const k of [1, 2, 3, 4].map((n) => `sk-acme-sky-rotated-${n}`)) {
			workingKeys.add(k);
		}
		expect((await submit("sk-acme-sky-rotated-1")).status).toBe(200);
		// A second submission replaces the first while it awaits review.
		expect((await submit("sk-acme-sky-rotated-2")).status).toBe(200);
		const keys = await db.query.providerKey.findMany({
			where: { provider: { eq: "acme-sky" } },
		});
		const byToken = new Map(keys.map((k) => [readProviderKey(k), k]));
		expect(byToken.get("sk-acme-sky-broken")).toBeUndefined();
		expect(byToken.get("sk-acme-sky-rotated-1")?.status).toBe("deleted");
		const pending = byToken.get("sk-acme-sky-rotated-2")!;
		expect(pending.status).toBe("inactive");
		// The live key keeps serving until the replacement is approved.
		expect(byToken.get("sk-acme-sky-serving-key")?.status).toBe("active");

		const listed = await (
			await app.request("/airside/companies", { headers: { Cookie: cookie } })
		).json();
		expect(listed.companies[0].claims[0]).toMatchObject({
			providerKey: { masked: original!.tokenMasked },
			pendingProviderKey: { masked: pending.tokenMasked },
		});

		const queue = await (
			await app.request("/admin/airside/claims?pendingProviderKey=true", {
				headers: { Cookie: cookie },
			})
		).json();
		expect(queue.claims.map((c: { id: string }) => c.id)).toEqual([claim.id]);

		const approved = await app.request(
			`/admin/airside/claims/${claim.id}/provider-key/approve`,
			json(cookie),
		);
		expect(approved.status).toBe(200);
		const approvedClaim = (await approved.json()).claim;
		expect(approvedClaim.providerKey.masked).toBe(pending.tokenMasked);
		expect(approvedClaim.pendingProviderKey).toBeNull();
		const after = await db.query.providerKey.findMany({
			where: { provider: { eq: "acme-sky" }, status: { eq: "active" } },
		});
		expect(after.map((k) => k.id)).toEqual([pending.id]);

		// A rejected replacement never serves; the live key stays.
		expect((await submit("sk-acme-sky-rotated-3")).status).toBe(200);
		const rejected = await app.request(
			`/admin/airside/claims/${claim.id}/provider-key/reject`,
			json(cookie),
		);
		expect(rejected.status).toBe(200);
		expect((await rejected.json()).claim).toMatchObject({
			providerKey: { masked: pending.tokenMasked },
			pendingProviderKey: null,
		});

		// The carrier can withdraw a replacement itself.
		expect((await submit("sk-acme-sky-rotated-4")).status).toBe(200);
		const withdrawn = await app.request(
			`/airside/claims/${claim.id}/provider-key`,
			json(cookie, undefined, "DELETE"),
		);
		expect(withdrawn.status).toBe(200);
		const remaining = await db.query.providerKey.findMany({
			where: { provider: { eq: "acme-sky" }, status: { ne: "deleted" } },
		});
		expect(remaining.map((k) => k.id)).toEqual([pending.id]);
	});

	it("lets an admin set or override a carrier's provider key", async () => {
		const { company, claim } = await approvedCarrier();
		stubCarrierUpstream(new Set(["sk-admin-set"]));
		const create = async (token: string, carrierKey?: boolean) => {
			const res = await app.request(
				"/admin/provider-credentials",
				json(cookie, { provider: "acme-sky", token, carrierKey }),
			);
			expect(res.status).toBe(201);
			return (await res.json()).credential as {
				id: string;
				carrierKey: boolean;
			};
		};
		const linkedKeyId = async () =>
			(
				await db.query.providerClaim.findFirst({
					where: { id: { eq: claim.id } },
				})
			)?.providerKeyId;

		// The testing key never serves traffic, from admin either.
		const reused = await app.request(
			"/admin/provider-credentials",
			json(cookie, { provider: "acme-sky", token: "sk-acme-sky-testing-key" }),
		);
		expect(reused.status).toBe(400);

		// A carrier without a key gets the admin's credential linked.
		const set = await create("sk-admin-set");
		const rotatedToTesting = await app.request(
			`/admin/provider-credentials/${set.id}`,
			json(cookie, { token: "sk-acme-sky-testing-key" }, "PATCH"),
		);
		expect(rotatedToTesting.status).toBe(400);
		expect(set.carrierKey).toBe(true);
		expect(await linkedKeyId()).toBe(set.id);
		// The carrier no longer has to file one with its first model.
		expect(
			(await createModel(cookie, company.id, sky("sky-large"))).status,
		).toBe(201);

		// An extra key leaves the carrier's key alone.
		const extra = await create("sk-admin-extra", false);
		expect(extra.carrierKey).toBe(false);
		expect(await linkedKeyId()).toBe(set.id);

		// Overriding links the new key and retires the old one.
		const override = await create("sk-admin-override", true);
		expect(await linkedKeyId()).toBe(override.id);
		const retired = await db.query.providerKey.findFirst({
			where: { id: { eq: set.id } },
		});
		expect(retired?.status).toBe("deleted");

		// Deleting the linked credential unlinks it.
		const deleted = await app.request(
			`/admin/provider-credentials/${override.id}`,
			json(cookie, undefined, "DELETE"),
		);
		expect(deleted.status).toBe(200);
		expect(await linkedKeyId()).toBeNull();
	});

	it("smoke-tests the serving key against every new listing", async () => {
		const { company } = await approvedCarrier();
		const workingKeys = new Set(["sk-acme-sky-serving-key"]);
		stubCarrierUpstream(workingKeys);
		const first = await createModel(
			cookie,
			company.id,
			sky("sky-large", "sk-acme-sky-serving-key"),
		);
		const { model } = await first.json();
		await app.request(
			`/admin/airside/filings/${model.pendingFiling.id}/approve`,
			json(cookie),
		);

		// The account behind the serving key lost access upstream.
		workingKeys.clear();
		const blocked = await createModel(cookie, company.id, sky("sky-small"));
		expect(blocked.status).toBe(400);
		expect((await blocked.json()).message).toContain(
			"smoke test against sky-small",
		);
		workingKeys.add("sk-acme-sky-serving-key");
		expect(
			(await createModel(cookie, company.id, sky("sky-small"))).status,
		).toBe(201);
	});

	it("records an email-matched domain without granting it to the company", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		expect((await registerCarrier(cookie, company.id)).status).toBe(201);

		const { domains } = await (
			await app.request(`/airside/companies/${company.id}/domains`, {
				headers: { Cookie: cookie },
			})
		).json();
		const emailRow = domains.find(
			(d: { method: string }) => d.method === "email",
		);
		expect(emailRow.domain).toBe("acme-sky.ai");
		expect(emailRow.verifiedAt).not.toBeNull();

		// A record of the proof, not a company grant: it is not listed as a
		// verified domain, cannot be removed, and does not outlive the email.
		const companies = await (
			await app.request("/airside/companies", { headers: { Cookie: cookie } })
		).json();
		expect(companies.companies[0].verifiedDomains).toEqual([]);
		const removed = await app.request(
			`/airside/companies/${company.id}/domains/${emailRow.id}`,
			json(cookie, undefined, "DELETE"),
		);
		expect(removed.status).toBe(404);
		await setUserEmail("ops@elsewhere.ai");
		const res = await registerCarrier(cookie, company.id, {
			providerId: "acme-sky-two",
		});
		expect(res.status).toBe(403);
	});

	it("rejects freemail accounts and flags them on the claimable list", async () => {
		await setUserEmail("someone@hotmail.com");
		const company = await createCompany(cookie, "Personal Co");
		const res = await registerCarrier(cookie, company.id, {
			baseUrl: "https://api.hotmail.com",
		});
		expect(res.status).toBe(403);

		const claimableRes = await app.request("/airside/claimable", {
			headers: { Cookie: cookie },
		});
		const claimableBody = await claimableRes.json();
		expect(claimableBody.emailDomainIsFreemail).toBe(true);
	});

	it("rejects a base URL that already carries the endpoint path", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		for (const baseUrl of [
			"https://api.acme-sky.ai/v1",
			"https://api.acme-sky.ai/v1/chat/completions",
			"https://api.acme-sky.ai/openai/chat/completions",
		]) {
			const res = await registerCarrier(cookie, company.id, { baseUrl });
			expect(res.status).toBe(400);
			expect((await res.json()).message).toContain("base URL only");
		}
		expect(
			(
				await registerCarrier(cookie, company.id, {
					baseUrl: "https://api.acme-sky.ai/openai",
				})
			).status,
		).toBe(201);
	});

	it("rejects a base URL whose host does not resolve", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		try {
			const res = await registerCarrier(cookie, company.id);
			expect(res.status).toBe(400);
			expect((await res.json()).message).toContain("could not be resolved");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("rejects a registration off the verified email domain", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const res = await registerCarrier(cookie, company.id, {
			baseUrl: "https://api.somebody-else.ai",
		});
		expect(res.status).toBe(403);
	});

	it("rejects catalogue and reserved carrier ids", async () => {
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		expect(
			(await registerCarrier(cookie, company.id, { providerId: "mistral" }))
				.status,
		).toBe(409);
		expect(
			(await registerCarrier(cookie, company.id, { providerId: "custom" }))
				.status,
		).toBe(409);
		expect(
			(await registerCarrier(cookie, company.id, { providerId: "Bad_Slug" }))
				.status,
		).toBe(400);
	});

	it("runs the custom carrier lifecycle: approve, credential, revoke", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@acme-sky.ai";
		await setUserEmail("ops@acme-sky.ai");
		const company = await createCompany(cookie, "Acme Sky");
		const res = await registerCarrier(cookie, company.id);
		expect(res.status).toBe(201);
		const { claim } = await res.json();

		// Approval creates the DB catalogue provider row.
		const approve = await app.request(
			`/admin/airside/claims/${claim.id}/approve`,
			json(cookie),
		);
		expect(approve.status).toBe(200);
		const providerRow = await db.query.provider.findFirst({
			where: { id: { eq: "acme-sky" } },
		});
		expect(providerRow?.name).toBe("Acme Sky");

		// The managed-credentials catalog now offers the carrier…
		const catalog = await app.request("/admin/provider-credentials/catalog", {
			headers: { Cookie: cookie },
		});
		expect(catalog.status).toBe(200);
		const catalogBody = await catalog.json();
		const entry = catalogBody.providers.find(
			(p: { id: string }) => p.id === "acme-sky",
		);
		expect(entry).toBeTruthy();
		expect(entry.configKeys).toEqual([]);

		// …and accepts a credential with no settings, but none with settings.
		const withConfig = await app.request(
			"/admin/provider-credentials",
			json(cookie, {
				provider: "acme-sky",
				token: "sk-acme-test",
				config: { baseUrl: "https://elsewhere.acme-sky.ai" },
			}),
		);
		expect(withConfig.status).toBe(400);
		const create = await app.request(
			"/admin/provider-credentials",
			json(cookie, {
				provider: "acme-sky",
				token: "sk-acme-test",
				config: {},
			}),
		);
		expect(create.status).toBe(201);

		// Revoking the claim removes the provider row again.
		const revoke = await app.request(
			`/admin/airside/claims/${claim.id}/revoke`,
			json(cookie, {}),
		);
		expect(revoke.status).toBe(200);
		const goneRow = await db.query.provider.findFirst({
			where: { id: { eq: "acme-sky" } },
		});
		expect(goneRow).toBeFalsy();
	});

	it("waives the listing fee with an admin-minted invite code", async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "ops@mistral.ai";
		process.env.AIRSIDE_LISTING_PRICE_ID = "price_test_airside";
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);

		// Admin mints a single-use code.
		const minted = await app.request(
			"/admin/airside/invite-codes",
			json(cookie, { note: "Mistral partnership", maxUses: 1 }),
		);
		expect(minted.status).toBe(201);
		const { code } = await minted.json();
		expect(code.code).toMatch(/^AIR-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
		expect(code.maxUses).toBe(1);

		// Claims stay gated while the fee is unpaid.
		const gated = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(gated.status).toBe(402);

		// A wrong code is rejected; the right one clears the fee.
		const wrong = await app.request(
			`/airside/companies/${company.id}/invite-code`,
			json(cookie, { code: "AIR-NOPE-NOPE" }),
		);
		expect(wrong.status).toBe(400);
		const redeemed = await app.request(
			`/airside/companies/${company.id}/invite-code`,
			json(cookie, { code: code.code.toLowerCase() }),
		);
		expect(redeemed.status).toBe(200);

		const companies = await app.request("/airside/companies", {
			headers: { Cookie: cookie },
		});
		expect((await companies.json()).companies[0]).toMatchObject({
			paymentStatus: "paid",
			listingInviteCodeUsed: true,
			listingFeeAmount: null,
		});
		const claimed = await app.request(
			"/airside/claims",
			json(cookie, { providerCompanyId: company.id, providerId: "mistral" }),
		);
		expect(claimed.status).toBe(201);

		// Re-redeeming on a settled company conflicts.
		const again = await app.request(
			`/airside/companies/${company.id}/invite-code`,
			json(cookie, { code: code.code }),
		);
		expect(again.status).toBe(409);

		// The single use is spent — a second company cannot redeem it.
		const second = await createCompany(cookie, "Mistral EU");
		const exhausted = await app.request(
			`/airside/companies/${second.id}/invite-code`,
			json(cookie, { code: code.code }),
		);
		expect(exhausted.status).toBe(400);

		// The admin listing shows usage and the redeeming company.
		const listed = await app.request("/admin/airside/invite-codes", {
			headers: { Cookie: cookie },
		});
		const listedBody = await listed.json();
		expect(listedBody.codes[0]).toMatchObject({
			code: code.code,
			usedCount: 1,
			redeemedBy: [expect.objectContaining({ name: "Mistral Ops" })],
		});

		// A revoked code stops redeeming even with uses left.
		const minted2 = await app.request(
			"/admin/airside/invite-codes",
			json(cookie, { maxUses: 5 }),
		);
		const code2 = (await minted2.json()).code;
		const revoked = await app.request(
			`/admin/airside/invite-codes/${code2.id}/revoke`,
			json(cookie),
		);
		expect(revoked.status).toBe(200);
		const afterRevoke = await app.request(
			`/airside/companies/${second.id}/invite-code`,
			json(cookie, { code: code2.code }),
		);
		expect(afterRevoke.status).toBe(400);
	});

	it.each([false, true])(
		"rolls back a failed crew email and allows retry (existing account: %s)",
		async (existing) => {
			await setUserEmail("ops@mistral.ai");
			const company = await createCompany(cookie);
			const email = "copilot@mistral.ai";
			if (existing) {
				await createSecondUser(email);
			}
			vi.mocked(emailUtils.sendTransactionalEmail).mockRejectedValueOnce(
				new Error("Delivery failed"),
			);
			const invite = () =>
				app.request(
					`/airside/companies/${company.id}/members`,
					json(cookie, { email }),
				);
			const failed = await invite();
			expect(failed.status).toBe(503);
			const crew = await app.request(
				`/airside/companies/${company.id}/members`,
				{ headers: { Cookie: cookie } },
			);
			const body = await crew.json();
			expect(body.members).toHaveLength(1);
			expect(body.invites).toHaveLength(0);
			expect((await invite()).status).toBe(201);
			expect(emailUtils.sendTransactionalEmail).toHaveBeenCalledTimes(2);
		},
	);

	it("manages the crew: invites, cap, domain rule, removal", async () => {
		await setUserEmail("ops@mistral.ai");
		const company = await createCompany(cookie);
		await claimProvider(cookie, company.id);

		// A teammate with an existing account attaches immediately.
		const teammateCookie = await createSecondUser("pilot@mistral.ai");
		const direct = await app.request(
			`/airside/companies/${company.id}/members`,
			json(cookie, { email: "Pilot@mistral.ai" }),
		);
		expect(direct.status).toBe(201);
		const directBody = await direct.json();
		expect(directBody.member).toMatchObject({
			email: "pilot@mistral.ai",
			role: "member",
		});
		expect(directBody.invite).toBeNull();
		expect(emailUtils.sendTransactionalEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: "pilot@mistral.ai",
				strict: true,
				text: expect.stringContaining("/login"),
			}),
		);

		// The teammate sees the company; a stranger's crew endpoints 404.
		const theirCompanies = await app.request("/airside/companies", {
			headers: { Cookie: teammateCookie },
		});
		expect((await theirCompanies.json()).companies).toHaveLength(1);

		// Members cannot invite — owners only.
		const memberInvite = await app.request(
			`/airside/companies/${company.id}/members`,
			json(teammateCookie, { email: "third@mistral.ai" }),
		);
		expect(memberInvite.status).toBe(403);

		// Off-domain invites are refused.
		const offDomain = await app.request(
			`/airside/companies/${company.id}/members`,
			json(cookie, { email: "friend@gmail.com" }),
		);
		expect(offDomain.status).toBe(400);

		// An unknown email becomes a pending invite…
		const invited = await app.request(
			`/airside/companies/${company.id}/members`,
			json(cookie, { email: "copilot@mistral.ai" }),
		);
		expect(invited.status).toBe(201);
		const invitedBody = await invited.json();
		expect(invitedBody.member).toBeNull();
		expect(invitedBody.invite).toMatchObject({ email: "copilot@mistral.ai" });
		expect(emailUtils.sendTransactionalEmail).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: "copilot@mistral.ai",
				strict: true,
				subject: "You've been invited to Mistral Ops on AirSide",
				text: expect.stringContaining("/signup"),
			}),
		);
		expect(emailUtils.sendTransactionalEmail).toHaveBeenCalledTimes(2);
		// …and inviting the same address twice conflicts.
		expect(
			(
				await app.request(
					`/airside/companies/${company.id}/members`,
					json(cookie, { email: "copilot@mistral.ai" }),
				)
			).status,
		).toBe(409);

		// The invitee signs up later and is attached on their first listing.
		const copilotCookie = await createSecondUser("copilot@mistral.ai");
		const attached = await app.request("/airside/companies", {
			headers: { Cookie: copilotCookie },
		});
		expect((await attached.json()).companies).toHaveLength(1);

		const crew = await app.request(`/airside/companies/${company.id}/members`, {
			headers: { Cookie: cookie },
		});
		const crewBody = await crew.json();
		expect(crewBody.viewerRole).toBe("owner");
		expect(crewBody.limit).toBe(10);
		expect(crewBody.members).toHaveLength(3);
		expect(crewBody.invites).toHaveLength(0);

		// The cap counts members plus pending invites.
		for (let i = 0; i < 7; i++) {
			const fill = await app.request(
				`/airside/companies/${company.id}/members`,
				json(cookie, { email: `crew${i}@mistral.ai` }),
			);
			expect(fill.status).toBe(201);
		}
		const overflow = await app.request(
			`/airside/companies/${company.id}/members`,
			json(cookie, { email: "one-too-many@mistral.ai" }),
		);
		expect(overflow.status).toBe(400);

		// Owners can revoke pending invites and remove members — not owners.
		const crewNow = await app.request(
			`/airside/companies/${company.id}/members`,
			{ headers: { Cookie: cookie } },
		);
		const crewNowBody = await crewNow.json();
		const pendingInvite = crewNowBody.invites[0];
		const revoked = await app.request(
			`/airside/companies/${company.id}/invites/${pendingInvite.id}`,
			{ method: "DELETE", headers: { Cookie: cookie } },
		);
		expect(revoked.status).toBe(200);
		const pilot = crewNowBody.members.find(
			(m: { email: string }) => m.email === "pilot@mistral.ai",
		);
		const removed = await app.request(
			`/airside/companies/${company.id}/members/${pilot.id}`,
			{ method: "DELETE", headers: { Cookie: cookie } },
		);
		expect(removed.status).toBe(200);
		const owner = crewNowBody.members.find(
			(m: { role: string }) => m.role === "owner",
		);
		const ownerRemoval = await app.request(
			`/airside/companies/${company.id}/members/${owner.id}`,
			{ method: "DELETE", headers: { Cookie: cookie } },
		);
		expect(ownerRemoval.status).toBe(400);

		// The removed teammate no longer sees the company.
		const afterRemoval = await app.request("/airside/companies", {
			headers: { Cookie: teammateCookie },
		});
		expect((await afterRemoval.json()).companies).toHaveLength(0);
	});
});
