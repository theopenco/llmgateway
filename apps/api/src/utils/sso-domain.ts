import { resolveDefaultProjectIds } from "@/lib/sso-default-projects.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { generateAutoJoinEmailHtml, sendTransactionalEmail } from "./email.js";

// Common consumer email providers. Auto-join must never target these: any org
// could otherwise claim e.g. "gmail.com" and absorb unrelated users.
export const CONSUMER_EMAIL_DOMAINS = new Set<string>([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"yahoo.com",
	"icloud.com",
	"me.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"gmx.com",
	"msn.com",
]);

const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * Normalizes an admin-provided domain: trims, lowercases, and strips a leading
 * "@" so "@Acme.com" and "acme.com" are stored identically.
 */
export function normalizeDomain(input: string): string {
	return input.trim().toLowerCase().replace(/^@/, "");
}

/**
 * Extracts the lowercased domain part after the last "@" of an email address,
 * or null if the value is not a well-formed address.
 */
export function extractEmailDomain(email: string): string | null {
	const at = email.lastIndexOf("@");
	if (at <= 0 || at === email.length - 1) {
		return null;
	}
	return email.slice(at + 1).toLowerCase();
}

/**
 * Whether a normalized domain may be configured for SSO auto-join: well-formed
 * and not a known consumer email provider.
 */
export function isConfigurableDomain(domain: string): boolean {
	return DOMAIN_PATTERN.test(domain) && !CONSUMER_EMAIL_DOMAINS.has(domain);
}

interface AutoJoinParams {
	userId: string;
	email: string;
	name?: string | null;
}

/**
 * Auto-joins a user to the enterprise organization that has claimed their email
 * domain for Google SSO auto-join. Returns the joined organization id, or null
 * when no join happened (no match, consumer domain, or already a member).
 *
 * Intended to run inside the auth post-sign-in hook for Google logins. It must
 * never throw into the login flow — failures are logged and swallowed.
 */
export async function autoJoinByEmailDomain({
	userId,
	email,
	name,
}: AutoJoinParams): Promise<string | null> {
	const domain = extractEmailDomain(email);
	if (!domain || CONSUMER_EMAIL_DOMAINS.has(domain)) {
		return null;
	}

	const organization = await db.query.organization.findFirst({
		where: {
			ssoAutoJoinDomain: { eq: domain },
			status: { ne: "deleted" },
			plan: { eq: "enterprise" },
		},
	});

	if (!organization) {
		return null;
	}

	const existingMembership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organization.id },
		},
	});

	if (existingMembership) {
		return null;
	}

	const [membership] = await db
		.insert(tables.userOrganization)
		.values({
			userId,
			organizationId: organization.id,
			role: "developer",
		})
		.returning();

	// Same default project grants as SSO/SCIM provisioning: the org's configured
	// selection, or the oldest project when unconfigured. Only on membership
	// creation, so later manual grant edits are never overwritten.
	const projectIds = await resolveDefaultProjectIds(organization.id);
	if (projectIds.length > 0) {
		await db
			.insert(tables.userProject)
			.values(
				projectIds.map((projectId) => ({
					userOrganizationId: membership.id,
					projectId,
				})),
			)
			.onConflictDoNothing();
	}

	await logAuditEvent({
		organizationId: organization.id,
		userId,
		action: "team_member.auto_join",
		resourceType: "team_member",
		resourceId: userId,
		metadata: { domain },
	});

	// Notify the joined user at their own (Google-verified) address. No
	// organizationId gate here: that flag gates on the org owner's verification,
	// but we're emailing the member, not the owner.
	await sendTransactionalEmail({
		to: email,
		subject: `You've been added to ${organization.name} on LLM Gateway`,
		html: generateAutoJoinEmailHtml(
			name ?? "",
			organization.name,
			organization.id,
		),
	});

	logger.info("Auto-joined user to organization via SSO domain match", {
		userId,
		organizationId: organization.id,
		domain,
	});

	return organization.id;
}
