import { HTTPException } from "hono/http-exception";

import { hasOrganizationEnterpriseAccess } from "@/lib/enterprise.js";

import { logViolation } from "@llmgateway/guardrails";
import { logger, toError } from "@llmgateway/logger";
import {
	customModelRef,
	customProviderRef,
	getProviderDefinition,
	isAttestationCompliant,
	isModelAllowedByPolicy,
	isProviderCompliant,
	isProviderRefAllowedByPolicy,
	narrowPolicyToDevPass,
	type ProviderComplianceAttestation,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";

interface OrganizationLike {
	id: string;
	plan: string;
	kind?: string | null;
	retentionLevel?: "retain" | "none" | null;
	providerCompliancePolicy?: ProviderCompliancePolicy | null;
}

export function isZeroDataRetentionEnabled(
	organization: OrganizationLike | null | undefined,
): boolean {
	return organization
		? getActiveCompliancePolicy(organization)?.zeroDataRetention === true
		: false;
}

export function getEffectiveRetentionLevel(
	organization: OrganizationLike | null | undefined,
): "retain" | "none" {
	return isZeroDataRetentionEnabled(organization)
		? "none"
		: (organization?.retentionLevel ?? "none");
}

/**
 * The active provider compliance policy for an organization, or `undefined`
 * when none should be enforced. Enterprise organizations get their complete
 * policy, while DevPass organizations get only the no-training requirement.
 */
export function getActiveCompliancePolicy(
	organization: OrganizationLike,
): ProviderCompliancePolicy | undefined {
	const policy = organization.providerCompliancePolicy;
	if (!policy?.enabled) {
		return undefined;
	}
	if (organization.kind === "devpass") {
		return narrowPolicyToDevPass(policy);
	}
	return hasOrganizationEnterpriseAccess(organization.id, organization.plan)
		? policy
		: undefined;
}

/** Request-scoped facts the policy needs beyond the catalogue. */
export interface ComplianceCheckContext {
	customAttestation?: ProviderComplianceAttestation | null;
	/** Routing-prefix name of the custom provider handling this request. */
	customProviderName?: string;
}

/** Whether a provider id satisfies the policy (unknown providers fail closed). */
export function isProviderIdCompliant(
	providerId: string,
	policy: ProviderCompliancePolicy,
	context?: ComplianceCheckContext,
): boolean {
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
	const definition = getProviderDefinition(providerId);
	return definition ? isProviderCompliant(definition, policy) : false;
}

/**
 * Whether the requested model passes the policy's fine-grained model lists. A
 * model served through a custom provider answers to both its bare model name
 * and the `<customProvider>/<model>` ref the dashboard stores.
 */
export function isModelIdCompliant(
	modelId: string,
	policy: ProviderCompliancePolicy,
	context?: ComplianceCheckContext,
): boolean {
	const modelRefs = context?.customProviderName
		? [modelId, customModelRef(context.customProviderName, modelId)]
		: [modelId];
	return isModelAllowedByPolicy(modelRefs, policy);
}

/** Drop provider mappings that don't satisfy the policy. */
export function filterCompliantProviders<T extends { providerId: string }>(
	list: T[],
	policy: ProviderCompliancePolicy,
	context?: ComplianceCheckContext,
): T[] {
	return list.filter((provider) =>
		isProviderIdCompliant(provider.providerId, policy, context),
	);
}

export function complianceBlockMessage(modelId: string): string {
	return `This request was blocked by your organization's provider compliance policy. No available provider for ${modelId} meets the required certifications or provider/model restrictions. Contact your LLMGateway admin to adjust the policy.`;
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
): Promise<void> {
	const policy = getActiveCompliancePolicy(organization);
	if (
		!policy ||
		(isProviderIdCompliant(providerId, policy) &&
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
