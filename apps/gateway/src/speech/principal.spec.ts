import { beforeEach, describe, expect, it, vi } from "vitest";

import { speech } from "./speech.js";

import type { GatewayApiKey } from "@/lib/cached-queries.js";

const state = vi.hoisted(() => ({
	key: {
		id: "key",
		projectId: "project",
		keyType: "platform",
		status: "active",
		endCustomerWalletId: "wallet",
		endUserSession: undefined as GatewayApiKey["endUserSession"],
	},
	wallet: { id: "wallet", status: "active", balance: "1", mode: "live" },
	project: {
		id: "project",
		organizationId: "org",
		status: "active",
		mode: "api-keys",
		allowedOrigins: ["https://allowed.example"],
	},
	organization: {
		id: "org",
		status: "active",
		kind: "default",
		credits: "10",
		devPlan: "none",
		chatPlan: "none",
		chatPlanCreditsLimit: "100",
		chatPlanCreditsUsed: "0",
		providerAccessRestriction: null,
	},
	byok: vi.fn(),
	platform: vi.fn(),
	fetch: vi.fn(),
	log: vi.fn(),
	spend: vi.fn(),
}));
vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(() => state.key),
	findProjectById: vi.fn(() => state.project),
	findOrganizationById: vi.fn(() => state.organization),
	findWalletById: vi.fn(() => state.wallet),
	findProviderKey: state.byok,
	getContentFilterSettings: vi.fn(),
	findActiveIamRules: vi.fn(() => []),
	findActiveTeamIamRules: vi.fn(() => []),
	findActiveUserIamRules: vi.fn(() => []),
}));
vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertMemberProjectAccess: vi.fn(),
	assertMemberWithinBudget: vi.fn(),
	assertApiKeyWithinUsageLimits: vi.fn(),
}));
vi.mock("@/lib/api-key-health.js", () => ({
	reportKeyError: vi.fn(),
	reportKeySuccess: vi.fn(),
	reportTrackedKeyError: vi.fn(),
	reportTrackedKeySuccess: vi.fn(),
}));
vi.mock("@/lib/api-key-fingerprint.js", () => ({
	getApiKeyFingerprint: vi.fn(() => "fingerprint"),
}));
vi.mock("@/lib/compliance.js", () => ({
	assertProviderCompliant: vi.fn(),
	getActiveCompliancePolicy: vi.fn(),
	getEffectiveRetentionLevel: vi.fn(() => "none"),
}));
vi.mock("@/lib/enterprise.js", () => ({
	getLicensedOrganizationEnvVariant: vi.fn(),
}));
vi.mock("@/lib/fetch-provider.js", () => ({
	fetchProvider: state.fetch,
	fetchProviderIssuedUrl: vi.fn(),
}));
vi.mock("@/lib/logs.js", () => ({
	calculateDataStorageCost: vi.fn(() => "0"),
	insertLog: state.log,
}));
vi.mock("@/lib/pending-work.js", () => ({ trackPendingWork: vi.fn() }));
vi.mock("@/lib/spend-limit.js", () => ({ assertSpendLimit: state.spend }));
vi.mock("@/chat/tools/resolve-platform-credential.js", () => ({
	getCredentialSetting: vi.fn(),
	resolvePlatformCredential: state.platform,
}));
vi.mock("@/chat/tools/content-filter-classifier.js", () => ({
	isContentFilterClassifierCompliant: vi.fn(() => true),
}));
vi.mock("@/chat/tools/run-tiered-content-filter.js", () => ({
	getContentFilterLogResponse: vi.fn(() => null),
	startTieredContentFilter: vi.fn(),
}));
vi.mock("@/chat/tools/tiered-content-filter.js", () => ({
	resolveTieredContentFilterPlan: vi.fn(() => null),
}));
vi.mock("@/chat/tools/retry-with-fallback.js", () => ({
	providerRetryKey: (provider: string, region?: string) =>
		`${provider}:${region ?? ""}`,
	getErrorType: vi.fn(),
	isRetryableErrorType: vi.fn(() => false),
	shouldRetryAlternateKey: vi.fn(() => false),
}));
vi.mock("@llmgateway/actions", () => ({
	RedirectError: class extends Error {},
	getGoogleVertexPublisherModelPath: vi.fn(),
	getOpenAiV1Prefix: vi.fn(() => "/v1"),
	getProviderHeaders: vi.fn(() => ({})),
	managedCredentialOptions: vi.fn(),
	providerKeyLabel: vi.fn(),
	readProviderKey: vi.fn(() => "byok-test-key"),
}));
vi.mock("@llmgateway/db", () => ({ shortid: vi.fn(() => "log-id") }));
vi.mock("@llmgateway/logger", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
	toError: vi.fn((error) => error),
}));
vi.mock("@llmgateway/shared", () => ({
	GATEWAY_CONTENT_FILTER_MESSAGE: "blocked",
}));

function request(origin?: string) {
	return speech.request("/", {
		method: "POST",
		headers: {
			Authorization: "Bearer test-token",
			"Content-Type": "application/json",
			...(origin ? { Origin: origin } : {}),
		},
		body: JSON.stringify({ model: "tts-1", input: "Hello", voice: "alloy" }),
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	state.key.keyType = "platform";
	state.key.endUserSession = {
		id: "session",
		walletId: "wallet",
		endCustomerId: "customer",
		expiresAt: new Date(Date.now() + 60_000),
		scope: { models: ["tts-1"] },
		walletStatus: "active",
		endCustomerStatus: "active",
		projectStatus: "active",
	};
	state.wallet.status = "active";
	state.wallet.mode = "live";
	state.wallet.balance = "1";
	state.project.mode = "api-keys";
	state.organization.credits = "10";
	state.organization.chatPlan = "none";
	state.byok.mockResolvedValue({ id: "byok", token: "byok-test-key" });
	state.platform.mockResolvedValue({ token: "platform-test-key" });
	state.fetch.mockImplementation(
		() =>
			new Response(new Uint8Array([1, 2]), {
				headers: { "Content-Type": "audio/mpeg" },
			}),
	);
});
describe("speech principals", () => {
	it("rejects expired SDK sessions", async () => {
		state.key.endUserSession!.expiresAt = new Date(Date.now() - 1);
		expect((await request()).status).toBe(401);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it.each(["walletStatus", "endCustomerStatus", "projectStatus"] as const)(
		"rejects inactive session %s",
		async (field) => {
			Object.assign(state.key.endUserSession!, { [field]: "deleted" });
			expect([401, 402]).toContain((await request()).status);
			expect(state.fetch).not.toHaveBeenCalled();
		},
	);
	it("rejects a frozen wallet loaded after authentication", async () => {
		state.wallet.status = "frozen";
		expect((await request()).status).toBe(402);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("rejects SDK sessions with no bound wallet", async () => {
		state.key.endUserSession!.walletId = "";
		expect((await request()).status).toBe(401);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("enforces session origin", async () => {
		expect((await request("https://denied.example")).status).toBe(403);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("enforces session model scope", async () => {
		state.key.endUserSession!.scope = { models: ["gpt-4o"] };
		expect((await request()).status).toBe(403);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("rejects sandbox spending on paid speech", async () => {
		state.wallet.mode = "test";
		expect((await request()).status).toBe(403);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("does not subsidize an empty wallet from parent chat-plan credits", async () => {
		state.wallet.balance = "0";
		state.organization.chatPlan = "plus";
		expect((await request()).status).toBe(402);
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it("does not subsidize an empty wallet from parent funds or BYOK", async () => {
		state.wallet.balance = "0";
		expect((await request()).status).toBe(402);
		expect(state.byok).not.toHaveBeenCalled();
		expect(state.fetch).not.toHaveBeenCalled();
	});
	it.each(["api-keys", "hybrid"])(
		"bills the live wallet instead of parent %s funds",
		async (mode) => {
			state.project.mode = mode;
			state.organization.credits = "0";
			expect((await request("https://allowed.example")).status).toBe(200);
			expect(state.byok).not.toHaveBeenCalled();
			expect(state.platform).toHaveBeenCalled();
			expect(state.spend).not.toHaveBeenCalled();
			expect(state.log).toHaveBeenCalledWith(
				expect.objectContaining({
					endCustomerWalletId: "wallet",
					endUserSessionId: "session",
					usedMode: "credits",
				}),
				expect.anything(),
			);
		},
	);
	it("rejects publishable principals", async () => {
		state.key.keyType = "platform_publishable";
		state.key.endUserSession = undefined;
		expect((await request()).status).toBe(401);
		expect(state.fetch).not.toHaveBeenCalled();
	});
});
vi.mock("@/lib/normalize-log-source.js", () => ({
	normalizeLogSource: vi.fn(() => null),
}));
