import { db, shortid, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

interface DefaultOrganizationUser {
	id: string;
	email: string;
}

interface DefaultOrganizationOptions {
	referralOrganizationId?: string | null;
}

function isActiveDashboardOrganization(userOrganization: {
	organization: typeof tables.organization.$inferSelect | null;
}): userOrganization is {
	organization: typeof tables.organization.$inferSelect;
} {
	return (
		userOrganization.organization !== null &&
		userOrganization.organization.status !== "deleted" &&
		userOrganization.organization.kind === "default"
	);
}

// Find the user's own default dashboard organization without creating one. Used
// by flows that only need to read the default org's settings (e.g. resolving
// DevPass invoice billing details) and must not create rows in a webhook.
//
// Restricted to orgs the user OWNS: a user can be an admin/developer member of
// another team's default org, and mirroring that org's billing details (email,
// company, address) onto a personal DevPass invoice would leak/charge to an org
// the user cannot even manage. DevPass-only users may own no default org at all,
// in which case callers fall back to the DevPass org's own details.
//
// A user can also own multiple default orgs, so pick deterministically by the
// oldest membership (when the user joined) rather than the org's own creation
// time: the user's own default org is the first one they became a member of (it
// is created together with their account at signup). Ordering by the org's
// createdAt would instead surface an older org the user was only later added to.
export async function findDefaultOrganization(userId: string) {
	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId,
			role: "owner",
		},
		with: {
			organization: true,
		},
		orderBy: {
			createdAt: "asc",
		},
	});

	return (
		userOrganizations.find(isActiveDashboardOrganization)?.organization ?? null
	);
}

export async function getOrCreateDefaultOrganization(
	user: DefaultOrganizationUser,
	options: DefaultOrganizationOptions = {},
) {
	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const existingOrganization = userOrganizations.find(
		isActiveDashboardOrganization,
	)?.organization;

	if (existingOrganization) {
		return existingOrganization;
	}

	return await db.transaction(async (tx) => {
		const currentUserOrganizations = await tx.query.userOrganization.findMany({
			where: {
				userId: user.id,
			},
			with: {
				organization: true,
			},
		});

		const currentOrganization = currentUserOrganizations.find(
			isActiveDashboardOrganization,
		)?.organization;

		if (currentOrganization) {
			return currentOrganization;
		}

		const [organization] = await tx
			.insert(tables.organization)
			.values({
				name: "Default Organization",
				billingEmail: user.email,
			})
			.returning();

		await tx.insert(tables.userOrganization).values({
			userId: user.id,
			organizationId: organization.id,
			role: "owner",
		});

		const [project] = await tx
			.insert(tables.project)
			.values({
				name: "Default Project",
				organizationId: organization.id,
				mode: "hybrid",
			})
			.returning();

		const prefix =
			process.env.NODE_ENV === "development" ? `llmgdev_` : "llmgtwy_";
		const token = prefix + shortid(40);

		await tx.insert(tables.apiKey).values({
			projectId: project.id,
			token,
			description: "Auto-generated playground key",
			usageLimit: null,
			createdBy: user.id,
		});

		if (options.referralOrganizationId) {
			const referrerOrg = await tx.query.organization.findFirst({
				where: {
					id: { eq: options.referralOrganizationId },
					status: { eq: "active" },
				},
			});

			if (referrerOrg) {
				await tx.insert(tables.referral).values({
					referrerOrganizationId: options.referralOrganizationId,
					referredOrganizationId: organization.id,
				});

				logger.info("Created referral record", {
					referrerOrgId: options.referralOrganizationId,
					referredOrgId: organization.id,
				});
			}
		}

		return organization;
	});
}
