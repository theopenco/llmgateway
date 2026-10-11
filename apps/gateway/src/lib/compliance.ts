import { HTTPException } from "hono/http-exception";

import { getEffectiveProviders } from "@llmgateway/db";
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
	isProviderCompliant,
	isProviderRefAllowedByPolicy,
	providers,
	type ComplianceFailureReason,
	type ProviderComplianceAttestation,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";

import type { ProviderDefinition } from "@llmgateway/models";

import { findDpaSignedProviderIds } from "./cached-queries.js";

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
 * configuration time in the API (full policies need enterprise access, other
 * plans may only save the data-protection subset in `DATA_PROTECTION_POLICY_KEYS`
 * and DevPass settings can only write the no-training requirement), but an
 * enabled stored policy must fail closed. Gating enforcement on plan/license
 * silently dropped all restrictions when the gate misfired, and narrowing by
 * kind stripped the full policy of a devpass-kind org that holds an enterprise
 * plan down to the no-training requirement — both are compliance breaches, not downgrades.
 */
export function getActiveCompliancePolicy(
	organization: OrganizationLike,
): ProviderCompliancePolicy | undefined {
	const policy = organization.providerCompliancePolicy;
	return policy?.enabled ? policy : undefined;
}

/**
 * Whether `requireGdpr` additionally requires a signed data-processing
 * agreement on record for the provider (`provider.dpaSignedAt`, maintained in
 * the admin dashboard). Off by default so enabling DPA tracking does not break
 * existing `requireGdpr` routing; infra flips the flag once the records are
 * filled in.
 */
export function isDpaEnforcementEnabled(): boolean {
	return process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR === "true";
}

/**
 * Pseudo-providers with no upstream operator to contract with: `llmgateway` is
 * the internal router, and `custom` providers carry their posture per-org as a
 * compliance attestation. Neither can have a DPA row, and blocking them here
 * would break routing that the DPA requirement is not about.
 */
const DPA_EXEMPT_PROVIDER_IDS = new Set(["llmgateway", "custom"]);

/**
 * Folds the DPA requirement into the policy by extending `blockedProviders`
 * with every catalogue provider that has no signed agreement on record.
 *
 * Expressed through the existing block list rather than a new check so every
 * consumer — pinned-provider checks, mapping filters, the OpenAI fallback —
 * enforces it without threading extra state through each call site. Under
 * `requireGdpr` the extra ids are at worst redundant: providers that are not
 * `gdpr: true` in the catalogue are already blocked. Note the dashboard's
 * impact preview cannot see this server-side merge (it knows neither the flag
 * nor the signed set), so with the flag on it may show a provider as allowed
 * that the gateway blocks.
 */
export function applyDpaRequirement(
	policy: ProviderCompliancePolicy,
	signedProviderIds: ReadonlySet<string>,
): ProviderCompliancePolicy {
	const unsigned = providers
		.filter(
			(provider) =>
				!DPA_EXEMPT_PROVIDER_IDS.has(provider.id) &&
				!signedProviderIds.has(provider.id),
		)
		.map((provider) => provider.id);

	if (unsigned.length === 0) {
		return policy;
	}

	return {
		...policy,
		blockedProviders: [...(policy.blockedProviders ?? []), ...unsigned],
	};
}

/**
 * Applies the signed-DPA requirement to an active policy when the enforcement
 * flag is on and the policy asks for GDPR-compliant providers. Anything else —
 * flag off, no policy, or a policy without `requireGdpr` — passes through
 * unchanged, so default routing is unaffected.
 */
export async function withDpaEnforcement(
	policy: ProviderCompliancePolicy | undefined,
): Promise<ProviderCompliancePolicy | undefined> {
	if (!policy?.requireGdpr || !isDpaEnforcementEnabled()) {
		return policy;
	}
	const signedIds = await findDpaSignedProviderIds();
	return applyDpaRequirement(policy, new Set(signedIds));
}

/** Request-scoped facts the policy needs beyond the catalogue. */
export interface ComplianceCheckContext {
	effectiveProviders?: readonly ProviderDefinition[];
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
	const definition =
		context?.effectiveProviders?.find(
			(provider) => provider.id === providerId,
		) ?? getProviderDefinition(providerId);
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
		const definition =
			context?.effectiveProviders?.find(
				(provider) => provider.id === providerId,
			) ?? getProviderDefinition(providerId);
		failures.push(
			...(definition
				? getProviderComplianceFailures(definition, policy)
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
