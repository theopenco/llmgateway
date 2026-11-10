import { HTTPException } from "hono/http-exception";

import { getEffectiveProviders } from "@llmgateway/db";
import { logViolation } from "@llmgateway/guardrails";
import { logger, toError } from "@llmgateway/logger";
import {
	customModelRef,
	customProviderRef,
	getAttestationComplianceFailures,
	getModelDenyRefs,
	getModelPolicyListFailures,
	getProviderComplianceFailures,
	getProviderDefinition,
	getProviderRefPolicyListFailures,
	isAttestationCompliant,
	isModelAllowedByPolicy,
	isProviderCompliant,
	isProviderRefAllowedByPolicy,
	withMappingDataPolicy,
	type ComplianceFailureReason,
	type MappingDataPolicy,
	type ProviderComplianceAttestation,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";

import type { ProviderDefinition } from "@llmgateway/models";

interface CompliancePolicySource {
	providerCompliancePolicy?: ProviderCompliancePolicy | null;
}

interface ActiveCompliancePolicy extends ProviderCompliancePolicy {
	allOf?: readonly ProviderCompliancePolicy[];
}

interface OrganizationLike {
	id: string;
	plan: string;
	kind?: string | null;
	retentionLevel?: "retain" | "none" | null;
	providerCompliancePolicy?: ProviderCompliancePolicy | null;
}

export function isZeroDataRetentionEnabled(
	organization: OrganizationLike | null | undefined,
	apiKey?: CompliancePolicySource | null,
): boolean {
	return organization
		? getActiveCompliancePolicy(organization, apiKey)?.zeroDataRetention ===
				true
		: false;
}

export function getEffectiveRetentionLevel(
	organization: OrganizationLike | null | undefined,
	apiKey?: CompliancePolicySource | null,
): "retain" | "none" {
	return isZeroDataRetentionEnabled(organization, apiKey)
		? "none"
		: (organization?.retentionLevel ?? "none");
}

/** Both enabled policies apply. Stored restrictions survive subscription changes. */
export function getActiveCompliancePolicy(
	organization: OrganizationLike,
	apiKey?: CompliancePolicySource | null,
): ActiveCompliancePolicy | undefined {
	const orgPolicy = organization.providerCompliancePolicy;
	const keyPolicy = apiKey?.providerCompliancePolicy;
	if (!orgPolicy?.enabled) {
		return keyPolicy?.enabled ? keyPolicy : undefined;
	}
	if (!keyPolicy?.enabled) {
		return orgPolicy;
	}
	// Empty allowlist intersections must deny all, not become unrestricted.
	// Custom model aliases must match each policy independently.
	return {
		enabled: true,
		zeroDataRetention:
			orgPolicy.zeroDataRetention || keyPolicy.zeroDataRetention,
		allOf: [orgPolicy, keyPolicy],
	};
}

/** Request-scoped facts the policy needs beyond the catalogue. */
export interface ComplianceCheckContext {
	effectiveProviders?: readonly ProviderDefinition[];
	customAttestation?: ProviderComplianceAttestation | null;
	/** Routing-prefix name of the custom provider handling this request. */
	customProviderName?: string;
	/** Data-policy overrides of the model mapping being checked. */
	mappingDataPolicy?: MappingDataPolicy;
}

function resolveProviderDefinition(
	providerId: string,
	context?: ComplianceCheckContext,
): ProviderDefinition | undefined {
	const definition =
		context?.effectiveProviders?.find(
			(provider) => provider.id === providerId,
		) ?? getProviderDefinition(providerId);
	return (
		definition && withMappingDataPolicy(definition, context?.mappingDataPolicy)
	);
}

/** Whether a provider id satisfies the policy (unknown providers fail closed). */
export function isProviderIdCompliant(
	providerId: string,
	policy: ActiveCompliancePolicy,
	context?: ComplianceCheckContext,
): boolean {
	if (policy.allOf) {
		return policy.allOf.every((constraint) =>
			isProviderIdCompliant(providerId, constraint, context),
		);
	}
	// "custom" has a catalogue entry with a null dataPolicy, so it must be
	// short-circuited before the lookup below or it always fails closed. The
	// policy's provider lists address custom providers as `custom:<name>`.
	if (providerId === "custom") {
		const providerRef = context?.customProviderName
			? customProviderRef(context.customProviderName)
			: providerId;
		return (
			isProviderRefAllowedByPolicy(providerRef, policy) &&
			isAttestationCompliant(context?.customAttestation, policy)
		);
	}
	const definition = resolveProviderDefinition(providerId, context);
	return definition ? isProviderCompliant(definition, policy) : false;
}

/**
 * Whether the requested model passes the policy's fine-grained model lists. A
 * model served through a custom provider answers to both its bare model name
 * and the `<customProvider>/<model>` ref the dashboard stores.
 */
export function isModelIdCompliant(
	modelId: string,
	policy: ActiveCompliancePolicy,
	context?: ComplianceCheckContext,
): boolean {
	if (policy.allOf) {
		return policy.allOf.every((constraint) =>
			isModelIdCompliant(modelId, constraint, context),
		);
	}
	return modelListFailures(modelId, policy, context).length === 0;
}

// A blocked alias blocks the model it resolves to, and a blocked model blocks
// listings named after its aliases; allowlists must name the model itself.
function modelListFailures(
	modelId: string,
	policy: ProviderCompliancePolicy,
	context?: ComplianceCheckContext,
): ComplianceFailureReason[] {
	const modelRefs = context?.customProviderName
		? [modelId, customModelRef(context.customProviderName, modelId)]
		: [modelId];
	const failures = getModelPolicyListFailures(modelRefs, policy);
	if (
		!failures.includes("blockedModels") &&
		!isModelAllowedByPolicy(getModelDenyRefs(modelId), {
			...policy,
			allowedModels: undefined,
		})
	) {
		failures.push("blockedModels");
	}
	return failures;
}

/**
 * Every policy rule a (provider, model) pair fails, so a routing exclusion can
 * say which constraint dropped the mapping rather than just "compliance".
 * Mirrors the checks `isProviderIdCompliant` / `isModelIdCompliant` run, and
 * never returns empty for a non-compliant pair: a provider id with no catalogue
 * entry fails closed as `unknownProvider`.
 */
export function getComplianceFailureReasons(
	providerId: string,
	modelId: string,
	policy: ActiveCompliancePolicy,
	context?: ComplianceCheckContext,
): ComplianceFailureReason[] {
	if (policy.allOf) {
		return Array.from(
			new Set(
				policy.allOf.flatMap((constraint) =>
					getComplianceFailureReasons(providerId, modelId, constraint, context),
				),
			),
		);
	}
	const failures: ComplianceFailureReason[] = [];
	if (providerId === "custom") {
		const providerRef = context?.customProviderName
			? customProviderRef(context.customProviderName)
			: providerId;
		failures.push(
			...getProviderRefPolicyListFailures(providerRef, policy),
			...getAttestationComplianceFailures(context?.customAttestation, policy),
		);
	} else {
		const definition = resolveProviderDefinition(providerId, context);
		failures.push(
			...(definition
				? getProviderComplianceFailures(definition, policy)
				: ["unknownProvider" as const]),
		);
	}
	failures.push(...modelListFailures(modelId, policy, context));
	return Array.from(new Set(failures));
}

/** Drop provider mappings that don't satisfy the policy. */
export function filterCompliantProviders<T extends { providerId: string }>(
	list: T[],
	policy: ActiveCompliancePolicy,
	context?: ComplianceCheckContext,
): T[] {
	return list.filter((provider) =>
		isProviderIdCompliant(provider.providerId, policy, context),
	);
}

export function complianceBlockMessage(modelId: string): string {
	return `This request was blocked by your organization or API key provider compliance policy. No available provider for ${modelId} meets the required certifications or provider/model restrictions. Contact your LLMGateway admin to adjust the policy.`;
}

/**
 * Record a compliance block as a security event. Logging failures never block
 * the request, but are surfaced so a missing event is diagnosable.
 */
export async function logComplianceBlock(
	organizationId: string,
	meta: { apiKeyId?: string; model?: string },
): Promise<void> {
	try {
		await logViolation(
			organizationId,
			{
				ruleId: "provider_compliance",
				ruleName: "Provider compliance policy",
				category: "provider_compliance",
				action: "block",
			},
			{ apiKeyId: meta.apiKeyId, model: meta.model },
		);
	} catch (error) {
		logger.error("Failed to log provider compliance violation", {
			error: toError(error),
			organizationId,
			apiKeyId: meta.apiKeyId,
			model: meta.model,
		});
	}
}

/**
 * Enforce the org's compliance policy for a single resolved provider (used by
 * endpoints that pick one provider rather than routing across many). Throws a
 * 403 and records a security event when the provider is non-compliant or the
 * model is excluded by the policy's fine-grained model lists.
 */
export async function assertProviderCompliant(
	organization: OrganizationLike,
	providerId: string,
	context: {
		organizationId: string;
		modelId: string;
		apiKeyId?: string;
		model?: string;
	},
	apiKey?: CompliancePolicySource | null,
): Promise<void> {
	const policy = getActiveCompliancePolicy(organization, apiKey);
	if (
		!policy ||
		(isProviderIdCompliant(providerId, policy, {
			effectiveProviders: await getEffectiveProviders(),
		}) &&
			isModelIdCompliant(context.modelId, policy))
	) {
		return;
	}
	await logComplianceBlock(context.organizationId, {
		apiKeyId: context.apiKeyId,
		model: context.model,
	});
	throw new HTTPException(403, {
		message: complianceBlockMessage(context.modelId),
	});
}
