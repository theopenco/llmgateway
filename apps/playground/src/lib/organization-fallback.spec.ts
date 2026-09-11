import { describe, expect, it } from "vitest";

import { findFallbackOrganization } from "./organization-fallback";

describe.each(["developer", "project_admin"] as const)(
	"%s membership",
	(role) => {
		const memberOrganization = { id: "team-org", role };

		it.each(["owner", "admin"] as const)(
			"prefers a funded %s organization regardless of list order",
			(adminRole) => {
				const fundedOrganization = {
					id: "funded-org",
					role: adminRole,
					credits: "10",
				};
				for (const organizations of [
					[memberOrganization, fundedOrganization],
					[fundedOrganization, memberOrganization],
				]) {
					expect(findFallbackOrganization(organizations)).toBe(
						fundedOrganization,
					);
				}
			},
		);

		it("falls back to the membership with hidden credits when admin orgs are unfunded", () => {
			expect(
				findFallbackOrganization([
					{ id: "empty-org", role: "owner", credits: "0" },
					memberOrganization,
				]),
			).toBe(memberOrganization);
		});
	},
);

it("does not select an admin organization without spendable credits", () => {
	expect(
		findFallbackOrganization([
			{ id: "empty-org", role: "owner", credits: "0" },
			{ id: "negative-org", role: "admin", credits: "-1" },
			{ id: "unknown-org", role: "owner" },
		]),
	).toBeUndefined();
});

it("has no fallback without memberships", () => {
	expect(findFallbackOrganization([])).toBeUndefined();
});
