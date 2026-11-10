import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cachedQueries from "@/lib/cached-queries.js";

import * as database from "@llmgateway/db";
import * as catalogue from "@llmgateway/models";

import { resolveDynamicRouteClassification } from "./resolve-dynamic-route-classification.js";

import type { ClassifierRequestContext } from "./log-classifier-usage.js";
import type { GatewayApiKey } from "@/lib/cached-queries.js";
import type {
	ProviderCompliancePolicy,
	ProviderDefinition,
} from "@llmgateway/models";
import type { ResolvedRoutingConfig } from "@llmgateway/shared/routing-config";

const effects = vi.hoisted(() => ({
	store: vi.fn(),
	cache: vi.fn(),
	credential: vi.fn(),
	classify: vi.fn(),
}));
vi.mock("@/lib/smart-routing-session.js", () => ({
	createDynamicRouteClassifierStore: effects.store,
}));
vi.mock("./content-filter-credential.js", () => ({
	hasContentFilterCredential: effects.credential,
}));
vi.mock("./jev-request-classifier.js", () => ({
	classifyRequest: effects.classify,
}));
const gdpr = { enabled: true, requireGdpr: true };
const enabled = { enabled: true };
const scopes: {
	name: string;
	org?: ProviderCompliancePolicy;
	key?: ProviderCompliancePolicy;
}[] = [
	{ name: "org", org: gdpr },
	{ name: "key", key: gdpr },
	{ name: "org GDPR and key", org: gdpr, key: enabled },
	{ name: "key GDPR and org", org: enabled, key: gdpr },
	{ name: "both", org: gdpr, key: gdpr },
];
function input(scope: (typeof scopes)[number]) {
	return {
		organization: {
			id: "org-test",
			plan: "enterprise",
			providerCompliancePolicy: scope.org,
		},
		context: {
			requestId: "synthetic-dpa-classifier",
			project: {
				id: "project-test",
				organizationId: "org-test",
			} as ClassifierRequestContext["project"],
			apiKey: {
				id: "key-test",
				providerCompliancePolicy: scope.key,
			} as GatewayApiKey,
			retentionLevel: "none" as const,
			requestedModel: "dynamic/test",
		},
		sessionId: "synthetic-session",
		sessionStickyEnabled: true,
		routingCfg: { session: { ttlSeconds: 60 } } as ResolvedRoutingConfig,
		messages: [{ role: "user" as const, content: "Synthetic private prompt" }],
		hasImages: false,
	};
}
const syntheticDefinition = (
	provider: ProviderDefinition,
): ProviderDefinition =>
	provider.id === "typesafe"
		? {
				...provider,
				dataPolicy: {
					...provider.dataPolicy,
					apiTraining: provider.dataPolicy?.apiTraining ?? null,
					promptLogging: provider.dataPolicy?.promptLogging ?? null,
					retentionPeriod: provider.dataPolicy?.retentionPeriod ?? null,
					gdpr: true,
				},
			}
		: provider;

describe("classifier DPA composition before cached verdicts or credentials", () => {
	beforeEach(() => {
		vi.stubEnv("REQUIRE_PROVIDER_DPA_FOR_GDPR", "true");
		vi.clearAllMocks();
		const lookup = catalogue.getProviderDefinition;
		vi.spyOn(catalogue, "getProviderDefinition").mockImplementation((id) => {
			const definition = lookup(id);
			return definition ? syntheticDefinition(definition) : undefined;
		});
		vi.spyOn(database, "getEffectiveProviders").mockResolvedValue(
			catalogue.providers.map(syntheticDefinition),
		);
		vi.spyOn(cachedQueries, "findDpaSignedProviderIds").mockResolvedValue([]);
		effects.store.mockReturnValue({
			get: effects.cache,
			refresh: vi.fn(),
			claim: vi.fn(),
		});
		effects.cache.mockResolvedValue({ classification: {} });
		effects.credential.mockResolvedValue(true);
		effects.classify.mockResolvedValue(null);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});
	function noDisclosure() {
		expect(effects.store).not.toHaveBeenCalled();
		expect(effects.cache).not.toHaveBeenCalled();
		expect(effects.credential).not.toHaveBeenCalled();
		expect(effects.classify).not.toHaveBeenCalled();
	}
	it.each(scopes)(
		"$name unsigned never reads cached verdicts or sends prompts",
		async (scope) => {
			expect(await resolveDynamicRouteClassification(input(scope))).toBeNull();
			expect(cachedQueries.findDpaSignedProviderIds).toHaveBeenCalled();
			noDisclosure();
		},
	);
	it.each(scopes)(
		"$name lookup failure cannot bypass the gate",
		async (scope) => {
			vi.mocked(cachedQueries.findDpaSignedProviderIds).mockRejectedValue(
				new Error("Synthetic signature outage"),
			);
			await expect(
				resolveDynamicRouteClassification(input(scope)),
			).rejects.toThrow("Synthetic signature outage");
			noDisclosure();
		},
	);
	it("waits for a delayed signature result without reading private state", async () => {
		let release!: (ids: string[]) => void;
		const pending = new Promise<string[]>((resolve) => {
			release = resolve;
		});
		vi.mocked(cachedQueries.findDpaSignedProviderIds).mockReturnValue(pending);
		const request = resolveDynamicRouteClassification(input(scopes[4]));
		expect(cachedQueries.findDpaSignedProviderIds).toHaveBeenCalled();
		noDisclosure();
		release([]);
		expect(await request).toBeNull();
		noDisclosure();
	});
	it("signed synthetic classifier still respects both policy floors", async () => {
		vi.mocked(cachedQueries.findDpaSignedProviderIds).mockResolvedValue([
			"typesafe",
		]);
		await resolveDynamicRouteClassification({
			...input(scopes[4]),
			sessionStickyEnabled: false,
		});
		expect(effects.credential).toHaveBeenCalled();
		expect(effects.classify).toHaveBeenCalledTimes(1);
		vi.clearAllMocks();
		await resolveDynamicRouteClassification(
			input({
				name: "blocked floor",
				org: { enabled: true, blockedProviders: ["typesafe"] },
				key: gdpr,
			}),
		);
		noDisclosure();
	});
});
