import { db, tables } from "@llmgateway/db";

interface PersonalOrgUser {
	id: string;
	email: string;
}

// Get or create the personal organization for a user (DevPass).
// Uses a transaction to ensure atomicity when creating org, membership, and project.
export async function getOrCreatePersonalOrg(user: PersonalOrgUser) {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const existingPersonalOrg = userOrgs.find(
		(uo) => uo.organization?.isPersonal === true,
	);

	if (existingPersonalOrg?.organization) {
		return existingPersonalOrg.organization;
	}

	return await db.transaction(async (tx) => {
		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "Personal",
				isPersonal: true,
				billingEmail: user.email,
				// DevPass orgs retain request/response data by default; users can
				// disable this from the data retention settings.
				retentionLevel: "retain",
			})
			.returning();

		await tx.insert(tables.userOrganization).values({
			userId: user.id,
			organizationId: newOrg.id,
			role: "owner",
		});

		await tx.insert(tables.project).values({
			name: "Default Project",
			organizationId: newOrg.id,
			mode: "credits",
		});

		return newOrg;
	});
}
