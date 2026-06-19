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
