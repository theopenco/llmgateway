import { getProviderCountries } from "@llmgateway/models";

import type { ComplianceFailureReason } from "@llmgateway/models";

const PROVIDER_COUNTRIES = getProviderCountries();

// Human-readable explanation for each way a provider can fail the org's
// compliance policy, shown on blocked chips and blocked model rows.
export const FAILURE_LABELS: Record<ComplianceFailureReason, string> = {
	requireSoc2: "No SOC 2 report",
	requireSoc2Type2: "No SOC 2 Type 2 report",
	requireIso27001: "No ISO 27001 certification",
	requireSoc2OrIso27001: "Neither SOC 2 Type 2 nor ISO 27001",
	requireGdpr: "Not GDPR compliant",
	blockApiTraining: "May train on API prompts",
	blockPromptLogging: "May log prompts",
	blockStealthProviders: "Stealth provider",
	allowedCountries: "Headquarters not in an allowed country",
	blockedProviders: "On the blocked-providers list",
	allowedProviders: "Not on the allowed-providers list",
	noAttestation: "No compliance attestation on file",
};

export function failureLabel(
	reason: ComplianceFailureReason,
	headquarters: string | null | undefined,
): string {
	if (reason === "allowedCountries" && headquarters) {
		const country = PROVIDER_COUNTRIES.find((c) => c.code === headquarters);
		return `Headquartered in ${country?.name ?? headquarters}, which is not an allowed country`;
	}
	return FAILURE_LABELS[reason];
}
