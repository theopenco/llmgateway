// SSO configuration is available to enterprise organizations and to Pro
// organizations that purchased the SSO add-on.
export function hasSsoAccess(
	org:
		| {
				plan: string | null;
				proSsoEnabled: boolean | null;
		  }
		| null
		| undefined,
): boolean {
	if (!org) {
		return false;
	}
	return (
		org.plan === "enterprise" || (org.plan === "pro" && !!org.proSsoEnabled)
	);
}

// SCIM provisioning is a separate add-on on top of SSO for Pro organizations;
// enterprise includes it.
export function hasScimAccess(
	org:
		| {
				plan: string | null;
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
		org.plan === "enterprise" ||
		(org.plan === "pro" && !!org.proSsoEnabled && !!org.proScimEnabled)
	);
}

export const SSO_PLAN_REQUIRED_MESSAGE =
	"SSO requires an enterprise plan or the Pro SSO add-on";

export const SCIM_PLAN_REQUIRED_MESSAGE =
	"SCIM provisioning requires an enterprise plan or the Pro SCIM add-on (on top of the SSO add-on)";
