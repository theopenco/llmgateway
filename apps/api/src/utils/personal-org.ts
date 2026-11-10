import { isUserHighRisk } from "@/lib/account-risk.js";

import { db, tables, sql } from "@llmgateway/db";

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
// org used by the coding product. It never touches the DevPass balance.
export async function getOrCreateChatOrg(user: PersonalOrgUser) {
	const existingChatOrg = await findChatOrgMembership(db, user.id);
	if (existingChatOrg) {
		return existingChatOrg;
	}

	const riskFlagged = await isUserHighRisk(user.id);

	return await db.transaction(async (tx) => {
		// Serialize first-time creation per user so concurrent callers cannot
		// each create a chat org.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${`chat-org:${user.id}`}))`,
		);

		const chatOrg = await findChatOrgMembership(tx, user.id);
		if (chatOrg) {
			return chatOrg;
		}

		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "Chat",
				kind: "chat",
				billingEmail: user.email,
				retentionLevel: "none",
				riskFlagged,
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

async function findChatOrgMembership(
	database: Pick<typeof db, "query">,
	userId: string,
) {
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
