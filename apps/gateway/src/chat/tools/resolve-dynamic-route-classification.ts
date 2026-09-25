import {
	getActiveCompliancePolicy,
	isProviderIdCompliant,
} from "@/lib/compliance.js";
import { createDynamicRouteClassifierStore } from "@/lib/smart-routing-session.js";

import { hasContentFilterCredential } from "./content-filter-credential.js";
import { classifyRequest } from "./jev-request-classifier.js";

import type { BaseMessage } from "@llmgateway/models";
import type { ResolvedRoutingConfig } from "@llmgateway/shared/routing-config";
import type { RequestClassification } from "@llmgateway/shared/smart-routing";

interface ResolveDynamicRouteClassificationParams {
	organization: Parameters<typeof getActiveCompliancePolicy>[0];
	project: { id: string; organizationId: string };
	apiKey: { id: string };
	requestId: string;
	sessionId?: string;
	sessionStickyEnabled: boolean;
	routingCfg: ResolvedRoutingConfig;
	messages: BaseMessage[];
	tools?: { type?: string; function?: { name?: string } }[];
	hasImages: boolean;
	requestSignal?: AbortSignal;
}

/**
 * Rate a request for a dynamic route's `classifier` nodes.
 *
 * Fail-open throughout: a blocked provider, a missing credential, an outage or
 * a timeout all return `null`, and those nodes then take their `else` branch.
 * A route must never fail because its classifier could not be reached.
 *
 * Like auto routing, a sticky session classifies once and reuses that verdict
 * for its remaining turns.
 */
export async function resolveDynamicRouteClassification(
	params: ResolveDynamicRouteClassificationParams,
): Promise<RequestClassification | null> {
	// The classifier sends prompt text to TypeSafe, so an organization whose
	// compliance policy disallows that provider must not have its prompts sent
	// there — the same fail-closed rule the content filter applies.
	const compliancePolicy = getActiveCompliancePolicy(params.organization);
	if (
		compliancePolicy &&
		!isProviderIdCompliant("typesafe", compliancePolicy)
	) {
		return null;
	}

	const sessionStore =
		params.sessionStickyEnabled && params.sessionId
			? createDynamicRouteClassifierStore(
					params.project.organizationId,
					params.project.id,
					params.sessionId,
					params.routingCfg.session.ttlSeconds,
				)
			: undefined;

	const saved = sessionStore ? await sessionStore.get() : null;
	if (saved) {
		await sessionStore!.refresh(saved);
		return saved.classification;
	}

	// The lookup reads the managed-credential table, which throws when both the
	// cache and its SWR mirror are gone.
	let hasCredential = false;
	try {
		hasCredential = await hasContentFilterCredential("typesafe");
	} catch {
		return null;
	}
	if (!hasCredential) {
		return null;
	}

	const classification = await classifyRequest(
		{
			messages: params.messages,
			toolNames: (params.tools ?? [])
				.map((tool) =>
					tool.type === "function" ? tool.function?.name : undefined,
				)
				.filter((name): name is string => Boolean(name)),
			hasImages: params.hasImages,
			estimatedInputTokens: 0,
			// A dynamic route picks the model itself, so there is no candidate
			// list to rank and the best-model question is not asked.
			candidates: [],
		},
		{
			requestId: params.requestId,
			organizationId: params.project.organizationId,
			projectId: params.project.id,
			apiKeyId: params.apiKey.id,
		},
		params.requestSignal,
	);

	if (classification && sessionStore) {
		await sessionStore.claim({ classification });
	}
	return classification;
}
