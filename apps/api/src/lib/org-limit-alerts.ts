import { notifyOrgLimitReached } from "@/utils/discord.js";

import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import type { EnterpriseSeatLimitError } from "@/lib/enterprise-seats.js";

export type OrgLimitEvent =
	| {
			limit: "seats";
			source: "scim" | "sso" | "invite";
			/** Internal only (Discord): may carry deployment-wide seat counts. */
			detail: string;
	  }
	| { limit: "api_keys"; projectId: string; maxApiKeys: number };

/** Discord detail for a deployment license seat rejection. */
export function licenseSeatDetail(error: EnterpriseSeatLimitError): string {
	return `Enterprise license: ${error.seatsUsed}/${error.maxSeats} seats`;
}

function describe(
	organizationId: string,
	event: OrgLimitEvent,
): { key: string; title: string; message: string; href: string } {
	const base = `/dashboard/${organizationId}`;
	if (event.limit === "api_keys") {
		return {
			key: "api_keys",
			title: "API key limit reached",
			message: `A member could not create an API key: the organization has reached its limit of ${event.maxApiKeys} active API keys. Revoke unused keys or contact us to raise the limit.`,
			href: `${base}/${event.projectId}/api-keys`,
		};
	}
	switch (event.source) {
		case "scim":
			return {
				key: "seats:scim",
				title: "Seat limit reached: directory sync rejected a user",
				message:
					"Your identity provider tried to add a user, but no seats are left. Contact us to add seats, then retry the failed provisioning in your identity provider. Each rejection is listed in the audit log.",
				href: `${base}/org/audit-logs`,
			};
		case "sso":
			return {
				key: "seats:sso",
				title: "Seat limit reached: SSO sign-in could not join",
				message:
					"A user signed in with SSO but could not be added to the organization because no seats are left. Contact us to add seats; they join on their next sign-in.",
				href: `${base}/org/team`,
			};
		case "invite":
			return {
				key: "seats:invite",
				title: "Seat limit reached: invite not accepted",
				message:
					"A user with a pending invite could not join because no seats are left. Free a seat or contact us to add more; the invite is retried on their next sign-in.",
				href: `${base}/org/team`,
			};
	}
}

/**
 * Tells an organization's owners and admins (bell + email, per their
 * preferences) and the internal Discord channel that a limit blocked an action.
 * At most once per organization, limit, and UTC day. Never throws: the caller
 * is already handling the rejection it reports.
 */
export async function notifyOrgLimit(
	organizationId: string,
	event: OrgLimitEvent,
): Promise<void> {
	try {
		const { key, title, message, href } = describe(organizationId, event);
		const day = new Date().toISOString().slice(0, 10);
		// Org-scoped key: notification rows dedupe on (userId, eventKey).
		const eventKey = `${organizationId}:org_limit:${key}:${day}`;
		const [alert] = await db
			.insert(tables.organizationAlert)
			.values({
				organizationId,
				type: "org_limit",
				eventKey,
				title,
				message,
				href,
			})
			.onConflictDoNothing()
			.returning({ id: tables.organizationAlert.id });
		if (!alert) {
			return;
		}

		const organization = await db.query.organization.findFirst({
			where: { id: { eq: organizationId } },
			columns: { name: true },
		});
		const members = await db.query.userOrganization.findMany({
			where: { organizationId: { eq: organizationId } },
			columns: { userId: true, role: true },
			with: { user: { columns: { status: true, emailVerified: true } } },
		});
		for (const member of members) {
			if (
				member.user?.status !== "active" ||
				!isOrganizationAdmin(member.role)
			) {
				continue;
			}
			const preference = await db.query.notificationPreference.findFirst({
				where: { userId: { eq: member.userId }, type: { eq: "org_limit" } },
			});
			const inApp = preference?.inApp ?? true;
			const email =
				(preference?.email ?? true) && member.user.emailVerified === true;
			if (!inApp && !email) {
				continue;
			}
			await db
				.insert(tables.notification)
				.values({
					userId: member.userId,
					organizationId,
					type: "org_limit",
					eventKey,
					title,
					message,
					href,
					inApp,
					email,
				})
				.onConflictDoNothing();
		}

		await notifyOrgLimitReached({
			organizationId,
			organizationName: organization?.name ?? organizationId,
			title,
			detail:
				event.limit === "api_keys"
					? `${event.maxApiKeys} active API keys`
					: event.detail,
		});
	} catch (error) {
		logger.error(
			"Failed to send organization limit alert",
			error instanceof Error ? error : new Error(String(error)),
			{ organizationId, limit: event.limit },
		);
	}
}
