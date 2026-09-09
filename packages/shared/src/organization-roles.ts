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
