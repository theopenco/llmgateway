import { describe, expect, it } from "vitest";

import {
	canManageProject,
	isOrganizationAdmin,
	isProjectScopedRole,
} from "./organization-roles.js";

describe("organization role boundaries", () => {
	it.each([
		{ role: "owner", orgAdmin: true, projectAdmin: true, scoped: false },
		{ role: "admin", orgAdmin: true, projectAdmin: true, scoped: false },
		{
			role: "project_admin",
			orgAdmin: false,
			projectAdmin: true,
			scoped: true,
		},
		{ role: "developer", orgAdmin: false, projectAdmin: false, scoped: true },
		{ role: undefined, orgAdmin: false, projectAdmin: false, scoped: false },
		{ role: "unknown", orgAdmin: false, projectAdmin: false, scoped: false },
	])(
		"separates $role project and organization privileges",
		({ role, orgAdmin, projectAdmin, scoped }) => {
			expect(isOrganizationAdmin(role)).toBe(orgAdmin);
			expect(canManageProject(role)).toBe(projectAdmin);
			expect(isProjectScopedRole(role)).toBe(scoped);
		},
	);
});
