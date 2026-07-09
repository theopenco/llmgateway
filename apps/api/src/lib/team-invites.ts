import { resolveSeatLimit } from "@/lib/seat-limit.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * Accept every pending, non-expired organization invite matching the user's
 * email: create the org membership (and project grants for developer invites)
 * and mark the invite accepted.
 *
 * Called from the auth after-hook (email/social/SSO sign-ins), the
 * email-verification callback, and SCIM user provisioning, so an invite sent
 * before the account existed is honored no matter how the account is created.
 * Callers must only pass emails that are trustworthy for the user (verified,
 * IdP-asserted, or self-hosted auto-verified).
 *
 * Errors are logged per invite instead of propagating — invite acceptance must
 * never break sign-in or provisioning.
 */
export async function acceptPendingInvitesForUser(user: {
	id: string;
	email: string;
}): Promise<void> {
	const email = user.email.trim().toLowerCase();
	if (!email) {
		return;
	}

	const invites = await db.query.organizationInvite.findMany({
		where: {
			email: { eq: email },
			status: { eq: "pending" },
		},
		with: {
			organization: true,
		},
	});

	const now = new Date();

	for (const invite of invites) {
		try {
			if (invite.expiresAt <= now) {
				continue;
			}
			const org = invite.organization;
			if (!org || org.status === "deleted") {
				continue;
			}

			const existingMembership = await db.query.userOrganization.findFirst({
				where: {
					userId: { eq: user.id },
					organizationId: { eq: invite.organizationId },
				},
				columns: { id: true },
			});

			if (!existingMembership) {
				const currentMembers = await db.query.userOrganization.findMany({
					where: { organizationId: { eq: invite.organizationId } },
					columns: { id: true },
				});
				const seatLimit = resolveSeatLimit(org.plan, org.seats);
				if (currentMembers.length >= seatLimit) {
					// Leave the invite pending so admins still see it and can free a
					// seat; it will be retried on the user's next sign-in.
					logger.warn(
						"Skipping team invite acceptance: organization at seat limit",
						{
							inviteId: invite.id,
							organizationId: invite.organizationId,
							seatLimit,
						},
					);
					continue;
				}

				const [membership] = await db
					.insert(tables.userOrganization)
					.values({
						userId: user.id,
						organizationId: invite.organizationId,
						role: invite.role,
					})
					.returning({ id: tables.userOrganization.id });

				if (invite.role === "developer" && invite.projectIds?.length) {
					// Grant only the invited projects that still exist in the org.
					const projects = await db.query.project.findMany({
						where: {
							organizationId: { eq: invite.organizationId },
							id: { in: invite.projectIds },
							status: { ne: "deleted" },
						},
						columns: { id: true },
					});
					if (projects.length) {
						await db
							.insert(tables.userProject)
							.values(
								projects.map((p) => ({
									userOrganizationId: membership.id,
									projectId: p.id,
								})),
							)
							.onConflictDoNothing();
					}
				}
			}

			await db
				.update(tables.organizationInvite)
				.set({
					status: "accepted",
					acceptedAt: now,
					acceptedByUserId: user.id,
				})
				.where(eq(tables.organizationInvite.id, invite.id));

			await logAuditEvent({
				organizationId: invite.organizationId,
				userId: user.id,
				action: "team_member.invite_accept",
				resourceType: "team_invite",
				resourceId: invite.id,
				metadata: {
					targetUserId: user.id,
					targetUserEmail: email,
					role: invite.role,
					...(invite.invitedBy ? { invitedBy: invite.invitedBy } : {}),
				},
			});
		} catch (error) {
			logger.error(
				"Failed to accept pending team invite",
				error instanceof Error ? error : new Error(String(error)),
				{ inviteId: invite.id, userId: user.id },
			);
		}
	}
}
