import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findProviderKey } from "@/lib/cached-queries.js";

import { moderations } from "./moderations.js";

import type { IamRule } from "@/lib/iam.js";
import type { ProviderAccessRestriction } from "@llmgateway/models";

const state = vi.hoisted(() => ({
	restriction: null as ProviderAccessRestriction | null,
	rules: [] as IamRule[],
	session: true,
}));
vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: async () => ({
		id: "key-id",
		status: "active",
		keyType: "end_user_customer",
		createdBy: "user-id",
		projectId: "project-id",
		endUserSession: state.session
			? { scope: { models: ["chat-model"] } }
			: undefined,
	}),
	findProjectById: async () => ({
		id: "project-id",
		organizationId: "org-id",
		mode: "api-keys",
	}),
	findOrganizationById: async () => ({
		id: "org-id",
		providerAccessRestriction: state.restriction,
	}),
	findProviderKey: vi.fn(async () => {
		throw new HTTPException(418, { message: "credential resolution reached" });
	}),
	findActiveIamRules: async () => state.rules,
	findActiveUserIamRules: async () => [],
	findActiveTeamIamRules: async () => [],
}));
vi.mock("@/lib/end-user-session.js", () => ({
	applyEndUserSession: async (
		_context: unknown,
		_key: unknown,
		project: unknown,
		organization: unknown,
	) => ({ project, organization, wallet: null }),
	assertTestWalletModelAllowed: vi.fn(),
	validateEndUserSessionModelAccess: (key: { endUserSession?: unknown }) =>
		key.endUserSession
			? { allowed: false, reason: "chat-only session scope" }
			: null,
}));
vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberProjectAccess: vi.fn(),
	assertMemberWithinBudget: vi.fn(),
}));
vi.mock("@/lib/compliance.js", () => ({
	assertProviderCompliant: vi.fn(),
	getEffectiveRetentionLevel: () => "none",
}));
vi.mock("@/lib/enterprise.js", () => ({
	getLicensedOrganizationEnvVariant: () => undefined,
}));
vi.mock("@/lib/logs.js", () => ({
	calculateDataStorageCost: vi.fn(),
	insertLog: vi.fn(),
}));
vi.mock("@/lib/spend-limit.js", () => ({ assertSpendLimit: vi.fn() }));
vi.mock("@/lib/api-key-health.js", () => ({
	reportKeyError: vi.fn(),
	reportKeySuccess: vi.fn(),
	reportTrackedKeyError: vi.fn(),
	reportTrackedKeySuccess: vi.fn(),
}));
vi.mock("@/chat/tools/create-log-entry.js", () => ({
	createLogEntry: vi.fn(),
}));
vi.mock("@/chat/tools/get-provider-env.js", () => ({
	getProviderEnv: vi.fn(),
}));
vi.mock("@/chat/tools/resolve-platform-credential.js", () => ({
	getCredentialSetting: vi.fn(),
	resolvePlatformCredential: vi.fn(),
}));
vi.mock("@/chat/tools/retry-with-fallback.js", () => ({
	shouldRetryAlternateKey: vi.fn(),
}));
vi.mock("@/lib/fetch-provider.js", () => ({ fetchProvider: vi.fn() }));
vi.mock("@llmgateway/actions", () => ({
	getProviderDefaultBaseUrl: vi.fn(),
	getProviderHeaders: vi.fn(),
	readProviderKey: vi.fn(),
}));
vi.mock("@llmgateway/db", () => ({ shortid: () => "request-id" }));
vi.mock("@llmgateway/shared/client-ip", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getClientIpFromRequest: () => "198.51.100.4",
}));

beforeEach(() => {
	vi.clearAllMocks();
	state.restriction = null;
	state.rules = [];
	state.session = true;
});
const request = () =>
	moderations.request("/", {
		method: "POST",
		headers: {
			authorization: "Bearer test-token",
			"content-type": "application/json",
		},
		body: JSON.stringify({ input: "hello" }),
	});
const rule = (
	ruleType: IamRule["ruleType"],
	ruleValue: IamRule["ruleValue"],
): IamRule => ({ id: "rule-id", status: "active", ruleType, ruleValue });

describe("moderation session IAM", () => {
	it("enforces the organization provider ceiling before credential access", async () => {
		state.restriction = {
			mode: "allow",
			providers: ["anthropic"],
			models: [],
			mappings: [],
		};
		expect((await request()).status).toBe(403);
		expect(findProviderKey).not.toHaveBeenCalled();
	});
	it.each([
		rule("deny_providers", { providers: ["openai"] }),
		rule("allow_providers", { providers: ["anthropic"] }),
		rule("deny_ip_cidrs", { ipCidrs: ["198.51.100.0/24"] }),
		rule("allow_ip_cidrs", { ipCidrs: ["192.0.2.0/24"] }),
	])("enforces session provider/IP rule $ruleType", async (iamRule) => {
		state.rules = [iamRule];
		expect((await request()).status).toBe(403);
		expect(findProviderKey).not.toHaveBeenCalled();
	});
	it("ignores only chat model and pricing rules for moderation", async () => {
		state.rules = [
			rule("allow_models", { models: ["chat-model"] }),
			rule("deny_pricing", { pricingType: "paid" }),
		];
		expect((await request()).status).toBe(418);
		expect(findProviderKey).toHaveBeenCalledOnce();
	});
	it("preserves the ordinary-key provider ceiling", async () => {
		state.session = false;
		state.rules = [rule("deny_providers", { providers: ["openai"] })];
		expect((await request()).status).toBe(403);
	});
});
