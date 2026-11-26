import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePlatformCredential } from "@/chat/tools/resolve-platform-credential.js";
import { validateRequestModelAccess } from "@/lib/iam.js";

import { realtimeClientSecretsRoute } from "./client-secrets-route.js";
import { createClientSecret } from "./client-secrets.js";
import { runRealtimePreflight } from "./preflight.js";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const policies = vi.hoisted(() => ({
	organization: null as ProviderCompliancePolicy | null,
	key: null as ProviderCompliancePolicy | null,
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(async () => ({
		id: "key-id",
		status: "active",
		keyType: "user",
		projectId: "project-id",
		providerCompliancePolicy: policies.key,
	})),
	findProjectById: vi.fn(async () => ({
		id: "project-id",
		organizationId: "org-id",
		status: "active",
		mode: "credits",
	})),
	findOrganizationById: vi.fn(async () => ({
		id: "org-id",
		kind: "default",
		status: "active",
		plan: "pro",
		credits: "10",
		devPlan: "none",
		chatPlan: "none",
		providerCompliancePolicy: policies.organization,
	})),
	findProviderKey: vi.fn(),
}));
vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberProjectAccess: vi.fn(),
	assertMemberWithinBudget: vi.fn(),
}));
vi.mock("@/chat/tools/resolve-platform-credential.js", () => ({
	resolvePlatformCredential: vi.fn(async () => ({
		token: "test-token",
		configIndex: 0,
	})),
}));
vi.mock("@/lib/api-key-fingerprint.js", () => ({
	getApiKeyFingerprint: () => "test-fingerprint",
}));
vi.mock("@/lib/enterprise.js", () => ({
	getLicensedOrganizationEnvVariant: () => undefined,
}));
vi.mock("@/lib/iam.js", () => ({
	validateRequestModelAccess: vi.fn(async () => ({ allowed: true })),
	throwIamException: vi.fn(),
}));
vi.mock("@llmgateway/actions", () => ({ readProviderKey: vi.fn() }));
vi.mock("@llmgateway/db", async () => ({
	getEffectiveProviders: async () =>
		(await import("@llmgateway/models")).providers,
	providerKeyAllowsModel: (
		allowedModels: string[] | null | undefined,
		modelId: string,
	) => !allowedModels?.length || allowedModels.includes(modelId),
}));
vi.mock("@llmgateway/guardrails", () => ({ logViolation: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	policies.organization = null;
	policies.key = null;
});

const connect = () =>
	runRealtimePreflight({
		token: "test-token",
		requestedModel: "gpt-realtime",
		clientIp: "198.51.100.4",
		advanceRoundRobin: false,
	});

describe("realtime ASR compliance preflight", () => {
	it.each(["organization", "key"] as const)(
		"excludes ASR denied by the %s policy before credential resolution",
		async (scope) => {
			policies[scope] = {
				enabled: true,
				blockedModels: ["gpt-4o-mini-transcribe"],
			};
			const result = await connect();
			expect(result.allowedTranscriptionModelIds).not.toContain(
				"gpt-4o-mini-transcribe",
			);
			expect(result.allowedTranscriptionModelIds).toContain(
				"gpt-4o-transcribe",
			);
		},
	);

	it("intersects organization and key model allowlists", async () => {
		policies.organization = {
			enabled: true,
			allowedModels: ["gpt-realtime", "gpt-4o-mini-transcribe"],
		};
		policies.key = {
			enabled: true,
			allowedModels: ["gpt-realtime", "gpt-4o-transcribe"],
		};
		expect((await connect()).allowedTranscriptionModelIds).toEqual([]);
	});

	it("restricts ASR to the organization model allowlist", async () => {
		policies.organization = {
			enabled: true,
			allowedModels: ["gpt-realtime", "gpt-4o-mini-transcribe"],
		};
		expect((await connect()).allowedTranscriptionModelIds).toEqual([
			"gpt-4o-mini-transcribe",
		]);
	});

	it("retains IAM exclusions and unrestricted historical ASR access", async () => {
		expect((await connect()).allowedTranscriptionModelIds).toContain(
			"gpt-4o-mini-transcribe",
		);
		vi.mocked(validateRequestModelAccess).mockImplementation(
			async ({ requestedModel }) => ({
				allowed: requestedModel !== "gpt-4o-mini-transcribe",
			}),
		);
		expect((await connect()).allowedTranscriptionModelIds).not.toContain(
			"gpt-4o-mini-transcribe",
		);
		vi.mocked(validateRequestModelAccess).mockResolvedValue({ allowed: true });
	});

	it("restricts ASR to the selected credential's allowed models", async () => {
		vi.mocked(resolvePlatformCredential).mockResolvedValueOnce({
			token: "test-token",
			configIndex: 0,
			managedKey: {
				id: "managed-key-id",
				allowedModels: ["gpt-realtime", "gpt-4o-transcribe"],
			},
		} as unknown as Awaited<ReturnType<typeof resolvePlatformCredential>>);
		expect((await connect()).allowedTranscriptionModelIds).toEqual([
			"gpt-4o-transcribe",
		]);
	});

	it.each(["organization", "key"] as const)(
		"rejects a provider denied by the %s policy before resolving credentials",
		async (scope) => {
			policies[scope] = { enabled: true, blockedProviders: ["openai"] };
			await expect(connect()).rejects.toMatchObject({ status: 403 });
			expect(resolvePlatformCredential).not.toHaveBeenCalled();
		},
	);
});

vi.mock("./client-secrets.js", () => ({
	clampClientSecretTtl: () => 60,
	MAX_CLIENT_SECRET_INSTRUCTIONS_TOKENS: 16_384,
	createClientSecret: vi.fn(),
}));

describe("ASR client secret compliance", () => {
	it.each(["organization", "key"] as const)(
		"rejects the %s blocked ASR model before minting a secret",
		async (scope) => {
			vi.stubEnv("REALTIME_ENABLED", "true");
			policies[scope] = {
				enabled: true,
				blockedModels: ["gpt-4o-mini-transcribe"],
			};
			try {
				const response = await realtimeClientSecretsRoute.request(
					"/client_secrets",
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: "Bearer test-token",
						},
						body: JSON.stringify({
							session: {
								type: "realtime",
								model: "gpt-realtime",
								audio: {
									input: { transcription: { model: "gpt-4o-mini-transcribe" } },
								},
							},
						}),
					},
				);
				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					error: { code: "transcription_model_not_allowed" },
				});
				expect(createClientSecret).not.toHaveBeenCalled();
			} finally {
				vi.unstubAllEnvs();
			}
		},
	);
});
