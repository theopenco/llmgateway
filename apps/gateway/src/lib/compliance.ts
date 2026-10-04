import { HTTPException } from "hono/http-exception";

import { logViolation } from "@llmgateway/guardrails";
import { logger, toError } from "@llmgateway/logger";
import {
	customModelRef,
	customProviderRef,
	getAttestationComplianceFailures,
	getModelPolicyListFailures,
	getProviderComplianceFailures,
	getProviderDefinition,
	getProviderRefPolicyListFailures,
	isAttestationCompliant,
	isModelAllowedByPolicy,
	isDataResidency,
	isProviderRefAllowedByPolicy,
	type ComplianceFailureReason,
	type DataResidency,
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
 * when none is enabled. Enforcement deliberately checks neither enterprise
 * access nor the organization kind: what a policy may contain is restricted at
 * configuration time in the API (full policies need enterprise access, DevPass
 * settings can only write the no-training requirement), but an enabled stored
 * policy must fail closed. Gating enforcement on plan/license silently dropped
 * all restrictions when the gate misfired, and narrowing by kind stripped the
 * full policy of a devpass-kind org that holds an enterprise plan down to the
 * no-training requirement — both are compliance breaches, not downgrades.
 */
export function getActiveCompliancePolicy(
	organization: OrganizationLike,
): ProviderCompliancePolicy | undefined {
	const policy = organization.providerCompliancePolicy;
	return policy?.enabled ? policy : undefined;
}

/** Request-scoped facts the policy needs beyond the catalogue. */
export interface ComplianceCheckContext {
	customAttestation?: ProviderComplianceAttestation | null;
	/** Routing-prefix name of the custom provider handling this request. */
	customProviderName?: string;
	/** Regional endpoint the mapping routes to; satisfies a matching residency. */
	region?: string | null;
}

export const DATA_RESIDENCY_HEADER = "x-llmgateway-data-residency";

/**
 * Residency requested by the call itself: the `x-llmgateway-data-residency`
 * header, or a regional hostname such as `eu.api.llmgateway.io`. Throws 400
 * on an unknown header value so a typo never silently routes globally.
 */
export function getRequestDataResidency(
	header: string | undefined,
	host: string | undefined,
): DataResidency | undefined {
	if (header) {
		const value = header.trim().toLowerCase();
		if (!isDataResidency(value)) {
			throw new HTTPException(400, {
				message: `Unsupported ${DATA_RESIDENCY_HEADER} value '${header}'. Supported: eu.`,
			});
		}
		return value;
	}
	const label = host?.split(".")[0]?.toLowerCase();
	return label && host?.includes(".") && isDataResidency(label)
		? label
		: undefined;
}

/**
 * The org policy tightened by a request-level residency. A request can only
 * add the restriction, never lift an org-level one.
 */
export function withRequestDataResidency(
	policy: ProviderCompliancePolicy | undefined,
	residency: DataResidency | undefined,
): ProviderCompliancePolicy | undefined {
	if (!residency) {
		return policy;
	}
	if (policy?.dataResidency && policy.dataResidency !== residency) {
		throw new HTTPException(400, {
			message: `This request asks for '${residency}' data residency, but your organization enforces '${policy.dataResidency}'.`,
		});
	}
	return { ...(policy ?? {}), enabled: true, dataResidency: residency };
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
	return definition
		? getProviderComplianceFailures(definition, policy, context?.region)
				.length === 0
		: false;
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
	policy: ProviderCompliancePolicy,
	context?: ComplianceCheckContext,
): ComplianceFailureReason[] {
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
		const definition = getProviderDefinition(providerId);
		failures.push(
			...(definition
				? getProviderComplianceFailures(definition, policy, context?.region)
				: ["unknownProvider" as const]),
		);
	}
	const modelRefs = context?.customProviderName
		? [modelId, customModelRef(context.customProviderName, modelId)]
		: [modelId];
	failures.push(...getModelPolicyListFailures(modelRefs, policy));
	return Array.from(new Set(failures));
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
	return `This request was blocked by your organization's provider compliance policy. No available provider for ${modelId} meets the required certifications, data residency, or provider/model restrictions. Contact your LLMGateway admin to adjust the policy.`;
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
