import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveDynamicRouteClassification } from "./resolve-dynamic-route-classification.js";

import type { ClassifierRequestContext } from "./log-classifier-usage.js";
import type { GatewayApiKey } from "@/lib/cached-queries.js";
import type * as ComplianceModule from "@/lib/compliance.js";
import type { ProviderCompliancePolicy } from "@llmgateway/models";
import type { ResolvedRoutingConfig } from "@llmgateway/shared/routing-config";

const mocks = vi.hoisted(() => ({
	policy: vi.fn(
		(
			_organization: unknown,
			key?: { providerCompliancePolicy?: ProviderCompliancePolicy },
		) => key?.providerCompliancePolicy,
	),
	classify: vi.fn(),
	credential: vi.fn(),
	store: vi.fn(),
}));

vi.mock("@/lib/compliance.js", async (importOriginal) => ({
	...(await importOriginal<typeof ComplianceModule>()),
	getActiveCompliancePolicy: mocks.policy,
	isProviderIdCompliant: (provider: string, policy: ProviderCompliancePolicy) =>
		!policy.blockedProviders?.includes(provider),
}));
vi.mock("@/lib/smart-routing-session.js", () => ({
	createDynamicRouteClassifierStore: mocks.store,
}));
vi.mock("./content-filter-credential.js", () => ({
	hasContentFilterCredential: mocks.credential,
}));
vi.mock("./jev-request-classifier.js", () => ({
	classifyRequest: mocks.classify,
}));

function params(policy?: ProviderCompliancePolicy) {
	return {
		organization: { id: "org-test", plan: "pro" },
		context: {
			requestId: "request-test",
			project: {
				id: "project-test",
				organizationId: "org-test",
			} as ClassifierRequestContext["project"],
			apiKey: {
				id: "key-test",
				providerCompliancePolicy: policy,
			} as GatewayApiKey,
			retentionLevel: "none" as const,
			requestedModel: "dynamic/test",
		},
		sessionId: "session-test",
		sessionStickyEnabled: true,
		routingCfg: { session: { ttlSeconds: 60 } } as ResolvedRoutingConfig,
		messages: [
			{
				role: "user" as const,
				content: "Do not send to the blocked classifier",
			},
		],
		hasImages: false,
	};
}

describe("dynamic route API key compliance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.credential.mockResolvedValue(true);
		mocks.classify.mockResolvedValue(null);
	});

	it("blocks before classifier credentials, cache or prompt dispatch", async () => {
		const input = params({ enabled: true, blockedProviders: ["typesafe"] });
		expect(await resolveDynamicRouteClassification(input)).toBeNull();
		expect(mocks.policy).toHaveBeenCalledWith(
			input.organization,
			input.context.apiKey,
		);
		expect(mocks.store).not.toHaveBeenCalled();
		expect(mocks.credential).not.toHaveBeenCalled();
		expect(mocks.classify).not.toHaveBeenCalled();
	});

	it("preserves classifier calls for unrestricted keys", async () => {
		const input = { ...params(), sessionStickyEnabled: false };
		await resolveDynamicRouteClassification(input);
		expect(mocks.classify).toHaveBeenCalledWith(
			expect.objectContaining({ messages: input.messages }),
			input.context,
			undefined,
		);
	});
});
