// SSO (and, transitively, SCIM — its tokens are issued through the SSO
// routes) is available to enterprise organizations and to Pro organizations
// that purchased the SSO & SCIM add-on.
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

export const SSO_PLAN_REQUIRED_MESSAGE =
	"SSO requires an enterprise plan or the Pro SSO & SCIM add-on";
