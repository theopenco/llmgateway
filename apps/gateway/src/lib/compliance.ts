import { HTTPException } from "hono/http-exception";

import { logViolation } from "@llmgateway/guardrails";
import { logger, toError } from "@llmgateway/logger";
import {
	getProviderDefinition,
	isProviderCompliant,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";

interface OrganizationLike {
	plan: string;
	providerCompliancePolicy?: ProviderCompliancePolicy | null;
}

/**
 * The active provider compliance policy for an organization, or `undefined`
 * when none should be enforced. Compliance is an enterprise feature, so the
 * policy only applies to enterprise orgs that have explicitly enabled it.
 */
export function getActiveCompliancePolicy(
	organization: OrganizationLike,
): ProviderCompliancePolicy | undefined {
	return organization.plan === "enterprise" &&
		organization.providerCompliancePolicy?.enabled
		? organization.providerCompliancePolicy
		: undefined;
}

/** Whether a provider id satisfies the policy (unknown providers fail closed). */
export function isProviderIdCompliant(
	providerId: string,
	policy: ProviderCompliancePolicy,
): boolean {
	const definition = getProviderDefinition(providerId);
	return definition ? isProviderCompliant(definition, policy) : false;
}

/** Drop provider mappings that don't satisfy the policy. */
export function filterCompliantProviders<T extends { providerId: string }>(
	list: T[],
	policy: ProviderCompliancePolicy,
): T[] {
	return list.filter((provider) =>
		isProviderIdCompliant(provider.providerId, policy),
	);
}

export function complianceBlockMessage(modelId: string): string {
	return `This request was blocked by your organization's provider compliance policy. No available provider for ${modelId} meets the required certifications. Contact your LLMGateway admin to adjust the policy.`;
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
 * 403 and records a security event when the provider is non-compliant.
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
	if (!policy || isProviderIdCompliant(providerId, policy)) {
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
