import { db, tables, eq } from "@llmgateway/db";

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
// chat.llmgateway.io (apps/playground): the chat plan, pay-as-you-go top-ups,
// and all playground billing live here, kept separate from the DevPass personal
// org used by the coding product.
//
// On first creation, any pay-as-you-go balance the user had on their personal
// org is migrated to the chat org so the playground keeps access to it.
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

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;
	const migratedCredits =
		personalOrg && parseFloat(personalOrg.credits || "0") > 0
			? personalOrg.credits
			: null;

	return await db.transaction(async (tx) => {
		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "Chat",
				kind: "chat",
				billingEmail: user.email,
				retentionLevel: "retain",
				...(migratedCredits ? { credits: migratedCredits } : {}),
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

		// One-time migration of the personal org's pay-as-you-go balance into the
		// chat org. Recorded as offsetting credit_gift transactions (excluded from
		// revenue analytics) so the move is auditable on both orgs.
		if (migratedCredits && personalOrg) {
			await tx
				.update(tables.organization)
				.set({ credits: "0" })
				.where(eq(tables.organization.id, personalOrg.id));

			await tx.insert(tables.transaction).values([
				{
					organizationId: personalOrg.id,
					type: "credit_gift",
					creditAmount: `-${migratedCredits}`,
					status: "completed",
					description: "Balance migrated to Chat organization",
				},
				{
					organizationId: newOrg.id,
					type: "credit_gift",
					creditAmount: migratedCredits,
					status: "completed",
					description: "Balance migrated from personal organization",
				},
			]);
		}

		return newOrg;
	});
}
