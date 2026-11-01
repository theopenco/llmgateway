import { Decimal } from "decimal.js";

import { isUserHighRisk } from "@/lib/account-risk.js";

import { db, tables, eq, sql } from "@llmgateway/db";

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
				// DevPass never retains request/response payloads — only metadata.
				// There is no setting to opt in.
				retentionLevel: "none",
				riskFlagged: await isUserHighRisk(user.id),
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
// lounge.llmgateway.io (apps/playground): the chat plan, pay-as-you-go top-ups,
// and all playground billing live here, kept separate from the DevPass personal
// org used by the coding product.
//
// On first creation, any pay-as-you-go balance the user had on their personal
// org is migrated to the chat org so the playground keeps access to it.
export async function getOrCreateChatOrg(user: PersonalOrgUser) {
	const existingChatOrg = await findChatOrgMembership(db, user.id);
	if (existingChatOrg) {
		return existingChatOrg;
	}

	const riskFlagged = await isUserHighRisk(user.id);

	return await db.transaction(async (tx) => {
		// Serialize first-time creation per user so concurrent callers cannot
		// each create a chat org seeded with the same migrated balance.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${`chat-org:${user.id}`}))`,
		);

		const userOrgs = await tx.query.userOrganization.findMany({
			where: {
				userId: user.id,
			},
			with: {
				organization: true,
			},
		});

		const chatOrg = userOrgs.find(
			(uo) => uo.organization?.kind === "chat",
		)?.organization;
		if (chatOrg) {
			return chatOrg;
		}

		const personalOrgId = userOrgs.find(
			(uo) => uo.organization?.kind === "devpass",
		)?.organization?.id;
		const [personalOrg] = personalOrgId
			? await tx
					.select({
						id: tables.organization.id,
						credits: tables.organization.credits,
					})
					.from(tables.organization)
					.where(eq(tables.organization.id, personalOrgId))
					.for("update")
			: [];
		const migratedCredits =
			personalOrg && new Decimal(personalOrg.credits ?? 0).gt(0)
				? personalOrg.credits
				: null;

		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "Chat",
				kind: "chat",
				billingEmail: user.email,
				retentionLevel: "none",
				riskFlagged,
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

async function findChatOrgMembership(database: typeof db, userId: string) {
	const userOrgs = await database.query.userOrganization.findMany({
		where: {
			userId,
		},
		with: {
			organization: true,
		},
	});
	return userOrgs.find((uo) => uo.organization?.kind === "chat")?.organization;
}
