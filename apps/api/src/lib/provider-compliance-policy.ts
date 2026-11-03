import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { models, providers } from "@llmgateway/models";
import { CUSTOM_PROVIDER_NAME_REGEX } from "@llmgateway/shared";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

const catalogueProviderIds = new Set<string>(
	providers.map((provider) => provider.id),
);

const catalogueModelIds = new Set<string>(models.map((model) => model.id));

const customProviderRefRegex = new RegExp(
	`^custom:${CUSTOM_PROVIDER_NAME_REGEX.source.slice(1, -1)}$`,
);

const customModelRefRegex = new RegExp(
	`^${CUSTOM_PROVIDER_NAME_REGEX.source.slice(1, -1)}/.+$`,
);

const complianceProviderRefSchema = z
	.string()
	.max(256)
	.refine(
		(ref) => catalogueProviderIds.has(ref) || customProviderRefRegex.test(ref),
		{ message: "Unknown provider" },
	);

const complianceModelRefSchema = z
	.string()
	.max(256)
	.refine(
		(ref) => catalogueModelIds.has(ref) || customModelRefRegex.test(ref),
		{
			message: "Unknown model",
		},
	);

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
	blockedProviders: z.array(complianceProviderRefSchema).max(500).optional(),
	allowedProviders: z.array(complianceProviderRefSchema).max(500).optional(),
	blockedModels: z.array(complianceModelRefSchema).max(500).optional(),
	allowedModels: z.array(complianceModelRefSchema).max(500).optional(),
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
