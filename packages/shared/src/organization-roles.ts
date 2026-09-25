export type OrganizationRole =
	"owner" | "admin" | "project_admin" | "developer";

export function isOrganizationAdmin(role: string | undefined): boolean {
	return role === "owner" || role === "admin";
}

export function isProjectScopedRole(role: string | undefined): boolean {
	return role === "project_admin" || role === "developer";
}

export function canManageProject(role: string | undefined): boolean {
	return isOrganizationAdmin(role) || role === "project_admin";
}

/**
 * Lowest organization role that receives an alert. Each level implies every
 * higher one: "admin" means owners and admins, "member" means everyone.
 */
export const alertAudiences = ["owner", "admin", "member"] as const;

export type AlertAudience = (typeof alertAudiences)[number];

export function isInAlertAudience(
	role: string | undefined,
	audience: AlertAudience,
): boolean {
	switch (audience) {
		case "owner":
			return role === "owner";
		case "admin":
			return isOrganizationAdmin(role);
		case "member":
			return isOrganizationAdmin(role) || isProjectScopedRole(role);
	}
}
