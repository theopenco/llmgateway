import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

// Refs outside the catalogue are kept: Airside-only and retired providers or
// models must not block saving the rest of the policy. A blocked ref that
// matches nothing has no effect; an allowed one admits nothing.
const complianceRefSchema = z.string().trim().min(1).max(256);

export const providerCompliancePolicySchema = z.object({
	enabled: z.boolean(),
	requireSoc2: z.boolean().optional(),
	requireSoc2Type2: z.boolean().optional(),
	requireIso27001: z.boolean().optional(),
	requireSoc2OrIso27001: z.boolean().optional(),
	requireGdpr: z.boolean().optional(),
	blockApiTraining: z.boolean().optional(),
	blockPromptLogging: z.boolean().optional(),
	zeroDataRetention: z.boolean().optional(),
	blockStealthProviders: z.boolean().optional(),
	allowedCountries: z
		.array(
			z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 country code"),
		)
		.optional(),
	blockedProviders: z.array(complianceRefSchema).max(500).optional(),
	allowedProviders: z.array(complianceRefSchema).max(500).optional(),
	blockedModels: z.array(complianceRefSchema).max(500).optional(),
	allowedModels: z.array(complianceRefSchema).max(500).optional(),
});

export function assertEnterpriseForCompliancePolicy(
	policy: ProviderCompliancePolicy | null | undefined,
	organization: { id: string; plan: string | null } | null,
): void {
	if (
		policy !== null &&
		policy !== undefined &&
		!hasOrganizationEnterpriseAccess(organization?.id, organization?.plan)
	) {
		throw new HTTPException(403, {
			message: "Provider compliance policies require an enterprise plan",
		});
	}
}
export function assertCanManageCompliancePolicy(
	policy: ProviderCompliancePolicy | null | undefined,
	role: string | null | undefined,
): void {
	if (policy !== undefined && role !== "owner" && role !== "admin") {
		throw new HTTPException(403, {
			message:
				"Only organization owners and admins can manage compliance policies",
		});
	}
}
export function assertApiKeyComplianceWritesEnabled(
	policy: ProviderCompliancePolicy | null | undefined,
): void {
	if (
		policy !== undefined &&
		policy !== null &&
		process.env.API_KEY_COMPLIANCE_ENABLED !== "true"
	) {
		throw new HTTPException(503, {
			message:
				"API key compliance configuration is not enabled for this deployment",
		});
	}
}
