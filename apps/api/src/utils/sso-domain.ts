import {
	EnterpriseSeatLimitError,
	withEnterpriseSeatForOrganization,
} from "@/lib/enterprise-seats.js";
import { resolveDefaultProjectIds } from "@/lib/sso-default-projects.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

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

interface JoinableOrganization {
	id: string;
	name: string;
}

/**
 * Adds a user to an organization as a developer with the org's default project
 * grants, then audits the join and notifies the user. Returns the organization
 * id, or null when the user is already a member.
 */
async function joinOrganizationAsDeveloper(
	organization: JoinableOrganization,
	{ userId, email, name }: AutoJoinParams,
	auditMetadata: Record<string, string>,
): Promise<string | null> {
	const existingMembership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organization.id },
		},
	});

	if (existingMembership) {
		return null;
	}

	const [membership] = await withEnterpriseSeatForOrganization(
		organization.id,
		userId,
		async (tx) =>
			await tx
				.insert(tables.userOrganization)
				.values({
					userId,
					organizationId: organization.id,
					role: "developer",
				})
				.returning(),
	);

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
		metadata: auditMetadata,
	});

	// Notify the joined user at their own (IdP-verified) address. No
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

	return organization.id;
}

/**
 * Auto-joins a user to the enterprise organization that has claimed their email
 * domain for Google SSO auto-join. Returns the joined organization id, or null
 * when no join happened (no match, consumer domain, or already a member).
 *
 * Intended to run inside the auth post-sign-in hook for Google logins. It must
 * never throw into the login flow — failures are logged and swallowed.
 */
export async function autoJoinByEmailDomain(
	params: AutoJoinParams,
): Promise<string | null> {
	const domain = extractEmailDomain(params.email);
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

	if (
		!organization ||
		!hasOrganizationEnterpriseAccess(organization.id, organization.plan)
	) {
		return null;
	}

	let joinedOrgId: string | null;
	try {
		joinedOrgId = await joinOrganizationAsDeveloper(organization, params, {
			domain,
		});
	} catch (error) {
		if (error instanceof EnterpriseSeatLimitError) {
			logger.warn("Skipped SSO domain auto-join at Enterprise seat limit", {
				userId: params.userId,
				organizationId: organization.id,
				maxSeats: error.maxSeats,
				seatsUsed: error.seatsUsed,
			});
			return null;
		}
		throw error;
	}

	if (joinedOrgId) {
		logger.info("Auto-joined user to organization via SSO domain match", {
			userId: params.userId,
			organizationId: joinedOrgId,
			domain,
		});
	}

	return joinedOrgId;
}

interface SsoProviderJoinParams extends AutoJoinParams {
	organizationId: string;
	ssoProviderId: string;
}

/**
 * Joins a user to the organization that owns the SSO connection they just
 * authenticated through (JIT provisioning). The org's IdP vouched for the
 * user, so membership intent is proven — without this, first-time SSO logins
 * at orgs without SCIM would be stranded in a fresh personal org instead of
 * joining their team. Returns the joined organization id, or null when no join
 * happened (org deleted or already a member).
 *
 * Intended to run inside the auth post-sign-in hook for SSO callback logins.
 * It must never throw into the login flow — failures are logged and swallowed.
 */
export async function autoJoinSsoProviderOrganization({
	organizationId,
	ssoProviderId,
	...params
}: SsoProviderJoinParams): Promise<string | null> {
	const organization = await db.query.organization.findFirst({
		where: {
			id: { eq: organizationId },
			status: { ne: "deleted" },
		},
	});

	if (
		!organization ||
		!hasOrganizationEnterpriseAccess(organization.id, organization.plan)
	) {
		return null;
	}

	let joinedOrgId: string | null;
	try {
		joinedOrgId = await joinOrganizationAsDeveloper(organization, params, {
			ssoProviderId,
		});
	} catch (error) {
		if (error instanceof EnterpriseSeatLimitError) {
			logger.warn("Skipped SSO auto-join at Enterprise seat limit", {
				userId: params.userId,
				organizationId: organization.id,
				maxSeats: error.maxSeats,
				seatsUsed: error.seatsUsed,
			});
			return null;
		}
		throw error;
	}

	if (joinedOrgId) {
		logger.info("Auto-joined user to organization via SSO sign-in", {
			userId: params.userId,
			organizationId: joinedOrgId,
			ssoProviderId,
		});
	}

	return joinedOrgId;
}
