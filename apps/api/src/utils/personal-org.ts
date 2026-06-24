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
		(uo) => uo.organization?.kind === "devpass",
	);

	if (existingPersonalOrg?.organization) {
		return existingPersonalOrg.organization;
	}

	return await db.transaction(async (tx) => {
		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "DevPass",
				kind: "devpass",
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

// Get or create the dedicated "Chat" organization for a user. This backs
// chat.llmgateway.io (apps/playground), kept separate from the DevPass personal
// org used by the coding product. Chat orgs run purely on virtual chat-plan
// credits and never hold a real `credits` balance — pay-as-you-go lives on
// default orgs.
export async function getOrCreateChatOrg(user: PersonalOrgUser) {
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const existingChatOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "chat",
	);

	if (existingChatOrg?.organization) {
		return existingChatOrg.organization;
	}

	return await db.transaction(async (tx) => {
		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "Chat",
				kind: "chat",
				billingEmail: user.email,
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
