import { PRO_PLAN_SSO_MAX_SEATS } from "@llmgateway/shared";

// SSO configuration is available to enterprise organizations and to Pro
// organizations that purchased the SSO add-on. The add-on is capped at
// PRO_PLAN_SSO_MAX_SEATS seats — checked here as well as at purchase time so
// a seat quantity raised past the cap out-of-band (e.g. via the Stripe
// portal) cuts SSO access off instead of silently exceeding the limit.
export function hasSsoAccess(
	org:
		| {
				plan: string | null;
				proSeats?: number | null;
				proSsoEnabled: boolean | null;
		  }
		| null
		| undefined,
): boolean {
	if (!org) {
		return false;
	}
	if (org.plan === "enterprise") {
		return true;
	}
	return (
		org.plan === "pro" &&
		!!org.proSsoEnabled &&
		org.proSeats !== null &&
		org.proSeats !== undefined &&
		org.proSeats <= PRO_PLAN_SSO_MAX_SEATS
	);
}

// SCIM provisioning is a separate add-on on top of SSO for Pro organizations;
// enterprise includes it.
export function hasScimAccess(
	org:
		| {
				plan: string | null;
				proSeats?: number | null;
				proSsoEnabled: boolean | null;
				proScimEnabled: boolean | null;
		  }
		| null
		| undefined,
): boolean {
	if (!org) {
		return false;
	}
	return (
		org.plan === "enterprise" || (hasSsoAccess(org) && !!org.proScimEnabled)
	);
}

export const SSO_PLAN_REQUIRED_MESSAGE = `SSO requires an enterprise plan or the Pro SSO add-on (available up to ${PRO_PLAN_SSO_MAX_SEATS} seats)`;

export const SCIM_PLAN_REQUIRED_MESSAGE =
	"SCIM provisioning requires an enterprise plan or the Pro SCIM add-on (on top of the SSO add-on)";
