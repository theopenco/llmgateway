import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	assertEnterpriseForIpCidrRule,
	createIamRuleSchema,
	iamRuleStatusEnum,
	iamRuleTypeEnum,
	iamRuleValueSchema,
	validateIamRuleInput,
} from "@/lib/iam-rules.js";
import { revokeMemberApiKeys } from "@/lib/revoke-member-api-keys.js";
import { resolveSeatLimit } from "@/lib/seat-limit.js";
import { sendTransactionalEmail } from "@/utils/email.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	addApiKeyPeriodDuration,
	and,
	apiKeyPeriodDurationUnits,
	cdb,
	db,
	eq,
	gte,
	inArray,
	isValidApiKeyPeriodDuration,
	resolveEffectiveMemberBudget,
	sum,
	tables,
	type OrgDefaultDeveloperBudget,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const team = new OpenAPIHono<ServerTypes>();

const roleSchema = z.enum(["owner", "admin", "developer"]);

const INVITE_EXPIRY_DAYS = 30;
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

const periodDurationUnitSchema = z.enum(apiKeyPeriodDurationUnits);

const memberBudgetSchema = z.object({
	maxApiKeys: z.number().int().nullable(),
	usageLimit: z.string().nullable(),
	periodUsageLimit: z.string().nullable(),
	periodUsageDurationValue: z.number().int().nullable(),
	periodUsageDurationUnit: periodDurationUnitSchema.nullable(),
});

const memberSpendSchema = z.object({
	lifetime: z.number(),
	currentPeriod: z.number().nullable(),
	activeApiKeys: z.number(),
});

const memberProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
});

const teamMemberSchema = z.object({
	id: z.string(),
	userId: z.string(),
	role: roleSchema,
	createdAt: z.date(),
	user: z.object({
		id: z.string(),
		email: z.string(),
		name: z.string().nullable(),
	}),
	// budget/spend are financial data — only populated for owner/admin callers,
	// null otherwise (developers can list members but not see spend/limits).
	// `budget` is the member's own explicit config (for editing); `effectiveBudget`
	// is what's enforced after applying the org-wide default developer budget.
	budget: memberBudgetSchema.nullable(),
	effectiveBudget: memberBudgetSchema.nullable(),
	spend: memberSpendSchema.nullable(),
	// Project access: null = every project in the org (owner/admin); an array =
	// the specific projects a project-scoped "developer" is limited to.
	projects: z.array(memberProjectSchema).nullable(),
});

const addMemberSchema = z.object({
	email: z.string().email(),
	role: roleSchema,
	// Required (non-empty) when role is "developer": the projects the member is
	// granted access to. Ignored for owner/admin (they get the whole org).
	projectIds: z.array(z.string()).optional(),
});

const teamInviteSchema = z.object({
	id: z.string(),
	email: z.string(),
	role: roleSchema,
	createdAt: z.date(),
	expiresAt: z.date(),
	// Projects a "developer" invite will be granted at acceptance; null for
	// owner/admin invites (whole-org access).
	projects: z.array(memberProjectSchema).nullable(),
});

interface PendingInviteRow {
	id: string;
	email: string;
	role: z.infer<typeof roleSchema>;
	createdAt: Date;
	expiresAt: Date;
	projectIds: string[] | null;
}

// Pending invites that have not expired yet. Expired invites stay in the table
// for history but no longer count toward seats, block re-invites, or accept.
async function listActivePendingInvites(
	organizationId: string,
): Promise<PendingInviteRow[]> {
	const invites = await db.query.organizationInvite.findMany({
		where: {
			organizationId: { eq: organizationId },
			status: { eq: "pending" },
		},
		columns: {
			id: true,
			email: true,
			role: true,
			createdAt: true,
			expiresAt: true,
			projectIds: true,
		},
	});
	const now = new Date();
	return invites.filter((invite) => invite.expiresAt > now);
}

// Resolve invite projectIds to {id,name} for display, dropping projects that
// were deleted since the invite was created.
async function invitesWithProjects(
	organizationId: string,
	invites: PendingInviteRow[],
): Promise<z.infer<typeof teamInviteSchema>[]> {
	const allProjectIds = Array.from(
		new Set(invites.flatMap((invite) => invite.projectIds ?? [])),
	);
	const projects = allProjectIds.length
		? await db.query.project.findMany({
				where: {
					organizationId: { eq: organizationId },
					id: { in: allProjectIds },
					status: { ne: "deleted" },
				},
				columns: { id: true, name: true },
			})
		: [];
	const projectById = new Map(projects.map((p) => [p.id, p]));

	return invites.map((invite) => ({
		id: invite.id,
		email: invite.email,
		role: invite.role,
		createdAt: invite.createdAt,
		expiresAt: invite.expiresAt,
		projects:
			invite.role === "developer"
				? (invite.projectIds ?? [])
						.map((id) => projectById.get(id))
						.filter((p): p is { id: string; name: string } => !!p)
				: null,
	}));
}

interface MemberBudgetRow {
	maxApiKeys: number | null;
	usageLimit: string | null;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: (typeof apiKeyPeriodDurationUnits)[number] | null;
}

function budgetFromRow(
	row: MemberBudgetRow,
): z.infer<typeof memberBudgetSchema> {
	return {
		maxApiKeys: row.maxApiKeys,
		usageLimit: row.usageLimit,
		periodUsageLimit: row.periodUsageLimit,
		periodUsageDurationValue: row.periodUsageDurationValue,
		periodUsageDurationUnit: row.periodUsageDurationUnit,
	};
}

function orgDefaultsFrom(
	org: Partial<OrgDefaultDeveloperBudget> | null | undefined,
): OrgDefaultDeveloperBudget {
	return {
		defaultDeveloperMaxApiKeys: org?.defaultDeveloperMaxApiKeys ?? null,
		defaultDeveloperUsageLimit: org?.defaultDeveloperUsageLimit ?? null,
		defaultDeveloperPeriodUsageLimit:
			org?.defaultDeveloperPeriodUsageLimit ?? null,
		defaultDeveloperPeriodUsageDurationValue:
			org?.defaultDeveloperPeriodUsageDurationValue ?? null,
		defaultDeveloperPeriodUsageDurationUnit:
			org?.defaultDeveloperPeriodUsageDurationUnit ?? null,
	};
}

// The org default developer budget, expressed as the member-budget shape (used
// by the "Default developer limits" editor).
function defaultBudgetFrom(
	defaults: OrgDefaultDeveloperBudget,
): z.infer<typeof memberBudgetSchema> {
	return {
		maxApiKeys: defaults.defaultDeveloperMaxApiKeys,
		usageLimit: defaults.defaultDeveloperUsageLimit,
		periodUsageLimit: defaults.defaultDeveloperPeriodUsageLimit,
		periodUsageDurationValue: defaults.defaultDeveloperPeriodUsageDurationValue,
		periodUsageDurationUnit: defaults.defaultDeveloperPeriodUsageDurationUnit,
	};
}

function effectiveBudgetFrom(
	row: MemberBudgetRow & { role: z.infer<typeof roleSchema> },
	defaults: OrgDefaultDeveloperBudget,
): z.infer<typeof memberBudgetSchema> {
	return resolveEffectiveMemberBudget(row.role, budgetFromRow(row), defaults);
}

const EMPTY_SPEND: z.infer<typeof memberSpendSchema> = {
	lifetime: 0,
	currentPeriod: null,
	activeApiKeys: 0,
};

interface MemberPeriodRow {
	userId: string;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: (typeof apiKeyPeriodDurationUnits)[number] | null;
}

/**
 * Compute live per-member spend/key display values from the durable per-key
 * sources (apiKey.usage + apiKeyHourlyStats.cost) — the same SUM queries the
 * gateway uses, but off the hot path here. Returns a map keyed by userId.
 */
async function computeMemberSpend(
	organizationId: string,
	members: MemberPeriodRow[],
): Promise<Map<string, z.infer<typeof memberSpendSchema>>> {
	const spendByUser = new Map<string, z.infer<typeof memberSpendSchema>>();
	if (members.length === 0) {
		return spendByUser;
	}

	const orgProjects = await db.query.project.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true },
	});
	const orgProjectIds = orgProjects.map((p) => p.id);

	const orgKeys = orgProjectIds.length
		? await db.query.apiKey.findMany({
				where: { projectId: { in: orgProjectIds } },
				columns: {
					id: true,
					createdBy: true,
					usage: true,
					status: true,
					keyType: true,
				},
			})
		: [];

	const keysByUser = new Map<
		string,
		{ keyIds: string[]; lifetime: number; activeApiKeys: number }
	>();
	for (const key of orgKeys) {
		const entry = keysByUser.get(key.createdBy) ?? {
			keyIds: [],
			lifetime: 0,
			activeApiKeys: 0,
		};
		entry.keyIds.push(key.id);
		entry.lifetime += Number(key.usage ?? 0);
		if (key.status === "active" && key.keyType === "user") {
			entry.activeApiKeys += 1;
		}
		keysByUser.set(key.createdBy, entry);
	}

	const now = new Date();
	for (const member of members) {
		const keys = keysByUser.get(member.userId);
		let currentPeriod: number | null = null;
		if (
			member.periodUsageLimit !== null &&
			member.periodUsageDurationValue !== null &&
			member.periodUsageDurationUnit !== null &&
			keys &&
			keys.keyIds.length
		) {
			const flooredHour = new Date(now);
			flooredHour.setMinutes(0, 0, 0);
			const windowStart = addApiKeyPeriodDuration(
				flooredHour,
				-member.periodUsageDurationValue,
				member.periodUsageDurationUnit,
			);
			const rows = await db
				.select({ total: sum(tables.apiKeyHourlyStats.cost) })
				.from(tables.apiKeyHourlyStats)
				.where(
					and(
						inArray(tables.apiKeyHourlyStats.apiKeyId, keys.keyIds),
						gte(tables.apiKeyHourlyStats.hourTimestamp, windowStart),
					),
				);
			currentPeriod = Number(rows[0]?.total ?? 0);
		}
		spendByUser.set(member.userId, {
			lifetime: keys?.lifetime ?? 0,
			currentPeriod,
			activeApiKeys: keys?.activeApiKeys ?? 0,
		});
	}

	return spendByUser;
}

const updateMemberSchema = z.object({
	role: roleSchema,
	// When the (new) role is "developer", the projects the member is limited to.
	projectIds: z.array(z.string()).optional(),
});

/**
 * Validate a developer's requested project grants against the org and return the
 * resolved {id,name} list. Throws 400 when the role/project combination is
 * invalid.
 */
async function resolveDeveloperProjects(
	organizationId: string,
	role: z.infer<typeof roleSchema>,
	projectIds: string[] | undefined,
): Promise<{ id: string; name: string }[]> {
	if (role !== "developer") {
		return [];
	}

	const unique = Array.from(new Set(projectIds ?? []));
	if (unique.length === 0) {
		throw new HTTPException(400, {
			message: "Developers must be granted access to at least one project.",
		});
	}

	const orgProjects = await db.query.project.findMany({
		where: {
			organizationId: { eq: organizationId },
			status: { ne: "deleted" },
			id: { in: unique },
		},
		columns: { id: true, name: true },
	});

	if (orgProjects.length !== unique.length) {
		throw new HTTPException(400, {
			message: "One or more selected projects do not belong to this org.",
		});
	}

	return orgProjects.map((p) => ({ id: p.id, name: p.name }));
}

/**
 * Replace a membership's project grants with exactly `projectIds` (developers),
 * or clear them entirely (owner/admin have implicit access to every project).
 */
async function syncMemberProjects(
	userOrganizationId: string,
	projectIds: string[],
): Promise<void> {
	await db
		.delete(tables.userProject)
		.where(eq(tables.userProject.userOrganizationId, userOrganizationId));

	if (projectIds.length) {
		await db.insert(tables.userProject).values(
			projectIds.map((projectId) => ({
				userOrganizationId,
				projectId,
			})),
		);
	}
}

const getMembers = createRoute({
	method: "get",
	path: "/{organizationId}/members",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						members: z.array(teamMemberSchema).openapi({}),
						// Pending invitations to people without an account yet; they join
						// automatically when they sign up (or are SCIM-provisioned).
						invites: z.array(teamInviteSchema),
						// The org-wide default developer budget (owner/admin only).
						defaultDeveloperBudget: memberBudgetSchema.nullable(),
						// Effective team-member seat cap (plan default or admin override).
						seatLimit: z.number().int(),
					}),
				},
			},
			description: "List of team members in the organization",
		},
	},
});

team.openapi(getMembers, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const members = await db.query.userOrganization.findMany({
		where: {
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
					name: true,
				},
			},
			userProjects: {
				with: {
					project: {
						columns: { id: true, name: true },
					},
				},
			},
		},
	});

	// Budget config and live spend are financial data — only expose them to
	// owners/admins. Developers can still list members and their roles.
	const isPrivileged =
		userOrganization.role === "owner" || userOrganization.role === "admin";

	const spendByUser = isPrivileged
		? await computeMemberSpend(organizationId, members)
		: new Map<string, z.infer<typeof memberSpendSchema>>();

	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
		columns: {
			plan: true,
			seats: true,
			defaultDeveloperMaxApiKeys: true,
			defaultDeveloperUsageLimit: true,
			defaultDeveloperPeriodUsageLimit: true,
			defaultDeveloperPeriodUsageDurationValue: true,
			defaultDeveloperPeriodUsageDurationUnit: true,
		},
	});
	const orgDefaults = orgDefaultsFrom(isPrivileged ? org : null);
	const seatLimit = resolveSeatLimit(org?.plan, org?.seats);

	const pendingInvites = await listActivePendingInvites(organizationId);
	const invites = await invitesWithProjects(organizationId, pendingInvites);

	return c.json({
		members: members.map((m) => ({
			id: m.id,
			userId: m.userId,
			role: m.role,
			createdAt: m.createdAt,
			user: m.user!,
			budget: isPrivileged ? budgetFromRow(m) : null,
			effectiveBudget: isPrivileged
				? effectiveBudgetFrom(m, orgDefaults)
				: null,
			spend: isPrivileged ? (spendByUser.get(m.userId) ?? EMPTY_SPEND) : null,
			// Owner/admin members have implicit access to every project (null);
			// developers are limited to their granted projects.
			projects:
				m.role === "developer"
					? m.userProjects
							.filter((up) => up.project)
							.map((up) => ({ id: up.project!.id, name: up.project!.name }))
					: null,
		})),
		invites,
		defaultDeveloperBudget: isPrivileged
			? defaultBudgetFrom(orgDefaults)
			: null,
		seatLimit,
	});
});

const getMyBudget = createRoute({
	method: "get",
	path: "/{organizationId}/members/me",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						budget: memberBudgetSchema,
						spend: memberSpendSchema,
					}),
				},
			},
			description:
				"The authenticated member's own budget config and live spend",
		},
	},
});

// Self-service: any member can read their OWN budget/spend (no admin gate), so
// they are aware of the limits an admin has set on them.
team.openapi(getMyBudget, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();

	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: {
				columns: {
					defaultDeveloperMaxApiKeys: true,
					defaultDeveloperUsageLimit: true,
					defaultDeveloperPeriodUsageLimit: true,
					defaultDeveloperPeriodUsageDurationValue: true,
					defaultDeveloperPeriodUsageDurationUnit: true,
				},
			},
		},
	});

	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const spend =
		(await computeMemberSpend(organizationId, [membership])).get(
			membership.userId,
		) ?? EMPTY_SPEND;

	// Show the member the budget actually enforced on them (their own values,
	// falling back to the org-wide default developer budget).
	return c.json({
		budget: effectiveBudgetFrom(
			membership,
			orgDefaultsFrom(membership.organization),
		),
		spend,
	});
});

const addMember = createRoute({
	method: "post",
	path: "/{organizationId}/members",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: addMemberSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						// Set when the email already had an account and was added directly.
						member: teamMemberSchema.nullable(),
						// Set when the email has no account yet: a pending invitation that
						// is auto-accepted when they sign up (email, SSO, or SCIM).
						invite: teamInviteSchema.nullable(),
					}),
				},
			},
			description: "Member added or invitation sent",
		},
	},
});

team.openapi(addMember, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();
	const { email, role, projectIds } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Block team management for personal orgs (dev plan only)
	if (
		userOrganization.organization?.kind === "devpass" ||
		userOrganization.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Team management is not available for personal organizations. Please create a regular organization to invite team members.",
		});
	}

	// Project-scoped "developer" access is an Enterprise feature.
	if (
		role === "developer" &&
		userOrganization.organization?.plan !== "enterprise"
	) {
		throw new HTTPException(403, {
			message: "Project-scoped developer access requires the Enterprise plan.",
		});
	}

	// Developers must be granted a valid, non-empty set of org projects.
	const grantedProjects = await resolveDeveloperProjects(
		organizationId,
		role,
		projectIds,
	);

	const currentMembers = await db.query.userOrganization.findMany({
		where: {
			organizationId: {
				eq: organizationId,
			},
		},
	});

	// Pending invites reserve a seat so accepted invites can't blow the cap.
	const pendingInvites = await listActivePendingInvites(organizationId);

	const memberLimit = resolveSeatLimit(
		userOrganization.organization?.plan,
		userOrganization.organization?.seats,
	);

	if (currentMembers.length + pendingInvites.length >= memberLimit) {
		throw new HTTPException(403, {
			message: `Your organization has reached the maximum of ${memberLimit} team members. Contact us at contact@llmgateway.io to unlock more seats.`,
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can add members",
		});
	}

	if (userOrganization.role === "admin" && role === "owner") {
		throw new HTTPException(403, {
			message: "Only owners can add other owners",
		});
	}

	const normalizedEmail = email.trim().toLowerCase();

	const targetUser = await db.query.user.findFirst({
		where: {
			email: {
				eq: normalizedEmail,
			},
		},
	});

	// No account with this email yet: create a pending invitation that is
	// auto-accepted when they sign up (email/social/SSO) or are provisioned via
	// SCIM, and email them a signup link.
	if (!targetUser) {
		if (pendingInvites.some((invite) => invite.email === normalizedEmail)) {
			throw new HTTPException(400, {
				message: "An invitation for this email is already pending",
			});
		}

		const [invite] = await db
			.insert(tables.organizationInvite)
			.values({
				organizationId,
				email: normalizedEmail,
				role,
				projectIds:
					role === "developer" ? grantedProjects.map((p) => p.id) : null,
				invitedBy: authUser.id,
				expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
			})
			.returning();

		const orgName = userOrganization.organization?.name ?? "an organization";
		const inviterName = authUser.name?.trim() || authUser.email;
		const uiUrl = process.env.UI_URL ?? "http://localhost:3002";

		const text = `Hey!

${inviterName} invited you to join the "${orgName}" organization on LLM Gateway as ${role === "admin" ? "an" : "a"} ${role}.

Create an account using this email address (${normalizedEmail}) and you'll be added to the organization automatically:

${uiUrl}/signup

If your organization uses SSO, signing in with SSO using this email works too.

This invitation expires in ${INVITE_EXPIRY_DAYS} days. If you weren't expecting it, you can safely ignore this email.

— The LLM Gateway Team`.trim();

		await sendTransactionalEmail({
			to: normalizedEmail,
			subject: `You've been invited to ${orgName} on LLM Gateway`,
			text,
			organizationId,
		});

		await logAuditEvent({
			organizationId,
			userId: authUser.id,
			action: "team_member.invite",
			resourceType: "team_invite",
			resourceId: invite.id,
			metadata: {
				targetUserEmail: normalizedEmail,
				role,
				projectIds: grantedProjects.map((p) => p.id),
			},
		});

		return c.json({
			message: "Invitation sent",
			member: null,
			invite: {
				id: invite.id,
				email: invite.email,
				role: invite.role,
				createdAt: invite.createdAt,
				expiresAt: invite.expiresAt,
				projects: role === "developer" ? grantedProjects : null,
			},
		});
	}

	const existingMember = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: targetUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (existingMember) {
		throw new HTTPException(400, {
			message: "User is already a member of this organization",
		});
	}

	const [newMember] = await db
		.insert(tables.userOrganization)
		.values({
			userId: targetUser.id,
			organizationId,
			role,
		})
		.returning();

	if (role === "developer") {
		await syncMemberProjects(
			newMember.id,
			grantedProjects.map((p) => p.id),
		);
	}

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.add",
		resourceType: "team_member",
		resourceId: newMember.id,
		metadata: {
			targetUserId: targetUser.id,
			targetUserEmail: email,
			role,
			projectIds: grantedProjects.map((p) => p.id),
		},
	});

	return c.json({
		message: "Member added successfully",
		member: {
			id: newMember.id,
			userId: newMember.userId,
			role: newMember.role,
			createdAt: newMember.createdAt,
			user: {
				id: targetUser.id,
				email: targetUser.email,
				name: targetUser.name,
			},
			budget: budgetFromRow(newMember),
			effectiveBudget: budgetFromRow(newMember),
			spend: EMPTY_SPEND,
			projects: role === "developer" ? grantedProjects : null,
		},
		invite: null,
	});
});

const revokeInvite = createRoute({
	method: "delete",
	path: "/{organizationId}/invites/{inviteId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			inviteId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Invitation revoked successfully",
		},
	},
});

team.openapi(revokeInvite, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, inviteId } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can revoke invitations",
		});
	}

	const invite = await db.query.organizationInvite.findFirst({
		where: {
			id: {
				eq: inviteId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (!invite || invite.status !== "pending") {
		throw new HTTPException(404, {
			message: "Invitation not found",
		});
	}

	// Mirror member management: only owners may manage owner-level invites.
	if (userOrganization.role === "admin" && invite.role === "owner") {
		throw new HTTPException(403, {
			message: "Only owners can revoke owner invitations",
		});
	}

	await db
		.update(tables.organizationInvite)
		.set({ status: "revoked" })
		.where(eq(tables.organizationInvite.id, inviteId));

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.invite_revoke",
		resourceType: "team_invite",
		resourceId: inviteId,
		metadata: {
			targetUserEmail: invite.email,
			role: invite.role,
		},
	});

	return c.json({
		message: "Invitation revoked successfully",
	});
});

const updateMember = createRoute({
	method: "patch",
	path: "/{organizationId}/members/{memberId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateMemberSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						member: teamMemberSchema.openapi({}),
					}),
				},
			},
			description: "Member role updated successfully",
		},
	},
});

team.openapi(updateMember, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();
	const { role, projectIds } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Block team management for personal orgs (dev plan only)
	if (
		userOrganization.organization?.kind === "devpass" ||
		userOrganization.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Team management is not available for personal organizations. Please create a regular organization to invite team members.",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can update member roles",
		});
	}

	// Project-scoped "developer" access is an Enterprise feature.
	if (
		role === "developer" &&
		userOrganization.organization?.plan !== "enterprise"
	) {
		throw new HTTPException(403, {
			message: "Project-scoped developer access requires the Enterprise plan.",
		});
	}

	// Developers need a valid, non-empty project grant list (validated up front).
	const grantedProjects = await resolveDeveloperProjects(
		organizationId,
		role,
		projectIds,
	);

	const targetMember = await db.query.userOrganization.findFirst({
		where: {
			id: {
				eq: memberId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
					name: true,
				},
			},
		},
	});

	if (!targetMember) {
		throw new HTTPException(404, {
			message: "Member not found",
		});
	}

	if (userOrganization.role === "admin" && targetMember.role === "owner") {
		throw new HTTPException(403, {
			message: "Admins cannot modify owner roles",
		});
	}

	if (userOrganization.role === "admin" && role === "owner") {
		throw new HTTPException(403, {
			message: "Only owners can grant owner role",
		});
	}

	if (targetMember.role === "owner") {
		const ownerCount = await db.query.userOrganization.findMany({
			where: {
				organizationId: {
					eq: organizationId,
				},
				role: {
					eq: "owner",
				},
			},
		});

		if (ownerCount.length === 1) {
			throw new HTTPException(400, {
				message: "Cannot change role of the last owner",
			});
		}
	}

	const [updatedMember] = await db
		.update(tables.userOrganization)
		.set({ role })
		.where(eq(tables.userOrganization.id, memberId))
		.returning();

	// Sync project grants: developers keep exactly the granted set; owner/admin
	// have implicit access to everything, so their grants are cleared.
	await syncMemberProjects(
		memberId,
		role === "developer" ? grantedProjects.map((p) => p.id) : [],
	);

	if (targetMember.role !== role) {
		await logAuditEvent({
			organizationId,
			userId: authUser.id,
			action: "team_member.update",
			resourceType: "team_member",
			resourceId: memberId,
			metadata: {
				targetUserId: targetMember.userId,
				targetUserEmail: targetMember.user?.email,
				changes: {
					role: { old: targetMember.role, new: role },
				},
			},
		});
	}

	const spend =
		(await computeMemberSpend(organizationId, [updatedMember])).get(
			updatedMember.userId,
		) ?? EMPTY_SPEND;

	return c.json({
		message: "Member role updated successfully",
		member: {
			id: updatedMember.id,
			userId: updatedMember.userId,
			role: updatedMember.role,
			createdAt: updatedMember.createdAt,
			user: targetMember.user!,
			budget: budgetFromRow(updatedMember),
			effectiveBudget: budgetFromRow(updatedMember),
			spend,
			projects: role === "developer" ? grantedProjects : null,
		},
	});
});

const updateBudgetSchema = z.object({
	maxApiKeys: z.number().int().min(0).nullable(),
	usageLimit: z.string().nullable(),
	periodUsageLimit: z.string().nullable(),
	periodUsageDurationValue: z.number().int().nullable(),
	periodUsageDurationUnit: periodDurationUnitSchema.nullable(),
});

function normalizeLimit(value: string | null): string | null {
	if (value === null || value.trim() === "") {
		return null;
	}
	const trimmed = value.trim();
	// Validate as a non-negative decimal string WITHOUT coercing through Number:
	// the column is a Postgres numeric, and Number() would round very large or
	// high-precision values before they are stored.
	if (!/^\d+(\.\d+)?$/.test(trimmed)) {
		throw new HTTPException(400, {
			message: "Spend limits must be non-negative numbers.",
		});
	}
	return trimmed;
}

const updateMemberBudget = createRoute({
	method: "patch",
	path: "/{organizationId}/members/{memberId}/budget",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateBudgetSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						member: teamMemberSchema.openapi({}),
					}),
				},
			},
			description: "Member budget updated successfully",
		},
	},
});

team.openapi(updateMemberBudget, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();
	const body = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Block team management for personal orgs (dev plan only)
	if (
		userOrganization.organization?.kind === "devpass" ||
		userOrganization.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Team management is not available for personal organizations. Please create a regular organization to invite team members.",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can update member budgets",
		});
	}

	const targetMember = await db.query.userOrganization.findFirst({
		where: {
			id: {
				eq: memberId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
					name: true,
				},
			},
		},
	});

	if (!targetMember) {
		throw new HTTPException(404, {
			message: "Member not found",
		});
	}

	// Mirror the role/remove endpoints: admins may not touch owners (a 0 budget
	// would break an owner's gateway requests and key creation).
	if (userOrganization.role === "admin" && targetMember.role === "owner") {
		throw new HTTPException(403, {
			message: "Admins cannot modify owner budgets",
		});
	}

	const usageLimit = normalizeLimit(body.usageLimit);
	const periodUsageLimit = normalizeLimit(body.periodUsageLimit);

	// Period config is all-or-nothing: a limit needs a duration and vice versa.
	const hasPeriodParts =
		periodUsageLimit !== null ||
		body.periodUsageDurationValue !== null ||
		body.periodUsageDurationUnit !== null;

	if (hasPeriodParts) {
		if (
			periodUsageLimit === null ||
			body.periodUsageDurationValue === null ||
			body.periodUsageDurationUnit === null
		) {
			throw new HTTPException(400, {
				message:
					"A period spend limit requires both a duration value and unit.",
			});
		}
		if (
			!isValidApiKeyPeriodDuration(
				body.periodUsageDurationValue,
				body.periodUsageDurationUnit,
			)
		) {
			throw new HTTPException(400, {
				message: "Invalid period duration.",
			});
		}
	}

	const nextBudget = {
		maxApiKeys: body.maxApiKeys,
		usageLimit,
		periodUsageLimit,
		periodUsageDurationValue: hasPeriodParts
			? body.periodUsageDurationValue
			: null,
		periodUsageDurationUnit: hasPeriodParts
			? body.periodUsageDurationUnit
			: null,
	};

	const [updatedMember] = await db
		.update(tables.userOrganization)
		.set(nextBudget)
		.where(eq(tables.userOrganization.id, memberId))
		.returning();

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.budget_update",
		resourceType: "team_member",
		resourceId: memberId,
		metadata: {
			targetUserId: targetMember.userId,
			targetUserEmail: targetMember.user?.email,
			changes: {
				budget: {
					old: budgetFromRow(targetMember),
					new: budgetFromRow(updatedMember),
				},
			},
		},
	});

	const spend =
		(await computeMemberSpend(organizationId, [updatedMember])).get(
			updatedMember.userId,
		) ?? EMPTY_SPEND;

	const memberProjects =
		updatedMember.role === "developer"
			? (
					await db.query.userProject.findMany({
						where: { userOrganizationId: { eq: updatedMember.id } },
						with: { project: { columns: { id: true, name: true } } },
					})
				)
					.filter((up) => up.project)
					.map((up) => ({ id: up.project!.id, name: up.project!.name }))
			: null;

	return c.json({
		message: "Member budget updated successfully",
		member: {
			id: updatedMember.id,
			userId: updatedMember.userId,
			role: updatedMember.role,
			createdAt: updatedMember.createdAt,
			user: targetMember.user!,
			budget: budgetFromRow(updatedMember),
			effectiveBudget: budgetFromRow(updatedMember),
			spend,
			projects: memberProjects,
		},
	});
});

const updateDefaultDeveloperBudget = createRoute({
	method: "patch",
	path: "/{organizationId}/default-developer-budget",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateBudgetSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						defaultDeveloperBudget: memberBudgetSchema,
					}),
				},
			},
			description: "Org-wide default developer budget updated",
		},
	},
});

// Set the org-wide default budget applied to every developer member (overridden
// per member by their own budget). Owner/admin only.
team.openapi(updateDefaultDeveloperBudget, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	const body = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: authUser.id },
			organizationId: { eq: organizationId },
		},
		with: { organization: true },
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (
		userOrganization.organization?.kind === "devpass" ||
		userOrganization.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Team management is not available for personal organizations. Please create a regular organization to invite team members.",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can update the default developer budget",
		});
	}

	const usageLimit = normalizeLimit(body.usageLimit);
	const periodUsageLimit = normalizeLimit(body.periodUsageLimit);

	const hasPeriodParts =
		periodUsageLimit !== null ||
		body.periodUsageDurationValue !== null ||
		body.periodUsageDurationUnit !== null;

	if (hasPeriodParts) {
		if (
			periodUsageLimit === null ||
			body.periodUsageDurationValue === null ||
			body.periodUsageDurationUnit === null
		) {
			throw new HTTPException(400, {
				message:
					"A period spend limit requires both a duration value and unit.",
			});
		}
		if (
			!isValidApiKeyPeriodDuration(
				body.periodUsageDurationValue,
				body.periodUsageDurationUnit,
			)
		) {
			throw new HTTPException(400, {
				message: "Invalid period duration.",
			});
		}
	}

	const nextDefaults = {
		defaultDeveloperMaxApiKeys: body.maxApiKeys,
		defaultDeveloperUsageLimit: usageLimit,
		defaultDeveloperPeriodUsageLimit: periodUsageLimit,
		defaultDeveloperPeriodUsageDurationValue: hasPeriodParts
			? body.periodUsageDurationValue
			: null,
		defaultDeveloperPeriodUsageDurationUnit: hasPeriodParts
			? body.periodUsageDurationUnit
			: null,
	};

	await db
		.update(tables.organization)
		.set(nextDefaults)
		.where(eq(tables.organization.id, organizationId));

	const defaultDeveloperBudget = defaultBudgetFrom(nextDefaults);

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "organization.update",
		resourceType: "organization",
		resourceId: organizationId,
		metadata: {
			changes: {
				defaultDeveloperBudget: {
					old: defaultBudgetFrom(
						orgDefaultsFrom(userOrganization.organization),
					),
					new: defaultDeveloperBudget,
				},
			},
		},
	});

	return c.json({
		message: "Default developer budget updated successfully",
		defaultDeveloperBudget,
	});
});

const removeMember = createRoute({
	method: "delete",
	path: "/{organizationId}/members/{memberId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Member removed successfully",
		},
	},
});

team.openapi(removeMember, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Block team management for personal orgs (dev plan only)
	if (
		userOrganization.organization?.kind === "devpass" ||
		userOrganization.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Team management is not available for personal organizations. Please create a regular organization to invite team members.",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can remove members",
		});
	}

	const targetMember = await db.query.userOrganization.findFirst({
		where: {
			id: {
				eq: memberId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
					name: true,
				},
			},
		},
	});

	if (!targetMember) {
		throw new HTTPException(404, {
			message: "Member not found",
		});
	}

	if (userOrganization.role === "admin" && targetMember.role === "owner") {
		throw new HTTPException(403, {
			message: "Admins cannot remove owners",
		});
	}

	if (targetMember.role === "owner") {
		const ownerCount = await db.query.userOrganization.findMany({
			where: {
				organizationId: {
					eq: organizationId,
				},
				role: {
					eq: "owner",
				},
			},
		});

		if (ownerCount.length === 1) {
			throw new HTTPException(400, {
				message: "Cannot remove the last owner",
			});
		}
	}

	await db
		.delete(tables.userOrganization)
		.where(eq(tables.userOrganization.id, memberId));

	// Revoke the removed member's API keys so their access actually stops; the
	// gateway does not re-check org membership on each request.
	await revokeMemberApiKeys(targetMember.userId, organizationId);

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.remove",
		resourceType: "team_member",
		resourceId: memberId,
		metadata: {
			targetUserId: targetMember.userId,
			targetUserEmail: targetMember.user?.email,
		},
	});

	return c.json({
		message: "Member removed successfully",
	});
});

export const memberIamRuleSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	userOrganizationId: z.string(),
	ruleType: iamRuleTypeEnum,
	ruleValue: iamRuleValueSchema,
	status: iamRuleStatusEnum,
});

// Shared guard for member-level IAM rule management: caller must be an
// owner/admin of a non-personal org, and admins may not touch owners' rules
// (mirrors the budget/role/remove endpoints).
async function requireMemberIamAccess(
	authUserId: string,
	organizationId: string,
	memberId: string,
) {
	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUserId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (
		userOrganization.organization?.kind === "devpass" ||
		userOrganization.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Team management is not available for personal organizations. Please create a regular organization to invite team members.",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage member IAM rules",
		});
	}

	const targetMember = await db.query.userOrganization.findFirst({
		where: {
			id: {
				eq: memberId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
				},
			},
		},
	});

	if (!targetMember) {
		throw new HTTPException(404, {
			message: "Member not found",
		});
	}

	if (userOrganization.role === "admin" && targetMember.role === "owner") {
		throw new HTTPException(403, {
			message: "Admins cannot modify owner IAM rules",
		});
	}

	return { userOrganization, targetMember };
}

const getMyIamRules = createRoute({
	method: "get",
	path: "/{organizationId}/members/me/iam",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(memberIamRuleSchema),
					}),
				},
			},
			description:
				"The authenticated member's own member-level IAM rules (the ceiling their API-key rules can only narrow)",
		},
	},
});

// Self-service: any member can read their OWN member-level rules (no admin
// gate), so they can understand why the gateway denies their requests.
team.openapi(getMyIamRules, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();

	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const rules = await db.query.userIamRule.findMany({
		where: {
			userOrganizationId: {
				eq: membership.id,
			},
		},
		orderBy: {
			createdAt: "asc",
		},
	});

	return c.json({ rules });
});

const createMemberIamRule = createRoute({
	method: "post",
	path: "/{organizationId}/members/{memberId}/iam",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createIamRuleSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						rule: memberIamRuleSchema,
					}),
				},
			},
			description: "Member IAM rule created successfully",
		},
	},
});

team.openapi(createMemberIamRule, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();
	const ruleData = c.req.valid("json");

	// Authorization first: unauthorized callers must not receive
	// input-validation feedback from a management endpoint.
	const { userOrganization, targetMember } = await requireMemberIamAccess(
		authUser.id,
		organizationId,
		memberId,
	);

	validateIamRuleInput(ruleData);
	assertEnterpriseForIpCidrRule(
		ruleData.ruleType,
		userOrganization.organization?.plan,
	);

	const [rule] = await cdb
		.insert(tables.userIamRule)
		.values({
			userOrganizationId: memberId,
			...ruleData,
		})
		.returning();

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.iam_rule.create",
		resourceType: "iam_rule",
		resourceId: rule.id,
		metadata: {
			memberId,
			targetUserId: targetMember.userId,
			targetUserEmail: targetMember.user?.email,
			ruleType: ruleData.ruleType,
			ruleValue: ruleData.ruleValue,
		},
	});

	return c.json({
		message: "Member IAM rule created successfully",
		rule,
	});
});

const listMemberIamRules = createRoute({
	method: "get",
	path: "/{organizationId}/members/{memberId}/iam",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(memberIamRuleSchema),
					}),
				},
			},
			description: "List a member's member-level IAM rules",
		},
	},
});

team.openapi(listMemberIamRules, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();

	await requireMemberIamAccess(authUser.id, organizationId, memberId);

	const rules = await db.query.userIamRule.findMany({
		where: {
			userOrganizationId: {
				eq: memberId,
			},
		},
		orderBy: {
			createdAt: "asc",
		},
	});

	return c.json({ rules });
});

const updateMemberIamRule = createRoute({
	method: "patch",
	path: "/{organizationId}/members/{memberId}/iam/{ruleId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
			ruleId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createIamRuleSchema.partial(),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						rule: memberIamRuleSchema,
					}),
				},
			},
			description: "Member IAM rule updated successfully",
		},
	},
});

team.openapi(updateMemberIamRule, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId, ruleId } = c.req.param();
	const updateData = c.req.valid("json");

	const { userOrganization, targetMember } = await requireMemberIamAccess(
		authUser.id,
		organizationId,
		memberId,
	);

	const existingRule = await db.query.userIamRule.findFirst({
		where: {
			id: {
				eq: ruleId,
			},
			userOrganizationId: {
				eq: memberId,
			},
		},
	});

	if (!existingRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found",
		});
	}

	// Re-validate using the effective ruleType + ruleValue after merging with
	// the existing rule, so partial updates can't bypass CIDR checks.
	if (updateData.ruleType || updateData.ruleValue) {
		validateIamRuleInput({
			ruleType: updateData.ruleType ?? existingRule.ruleType,
			ruleValue: updateData.ruleValue ?? existingRule.ruleValue,
		});
	}

	assertEnterpriseForIpCidrRule(
		updateData.ruleType ?? existingRule.ruleType,
		userOrganization.organization?.plan,
	);

	// An empty PATCH body is a valid no-op; drizzle throws "No values to set"
	// on an empty update, so skip the query and return the rule unchanged.
	let updatedRule = existingRule;
	if (Object.keys(updateData).length > 0) {
		[updatedRule] = await cdb
			.update(tables.userIamRule)
			.set(updateData)
			.where(eq(tables.userIamRule.id, ruleId))
			.returning();
	}

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.iam_rule.update",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: {
			memberId,
			targetUserId: targetMember.userId,
			targetUserEmail: targetMember.user?.email,
			changes: {
				...(updateData.ruleType !== undefined &&
				existingRule.ruleType !== updateData.ruleType
					? {
							ruleType: {
								old: existingRule.ruleType,
								new: updateData.ruleType,
							},
						}
					: {}),
				...(updateData.ruleValue !== undefined
					? {
							ruleValue: {
								old: existingRule.ruleValue,
								new: updateData.ruleValue,
							},
						}
					: {}),
				...(updateData.status !== undefined &&
				existingRule.status !== updateData.status
					? { status: { old: existingRule.status, new: updateData.status } }
					: {}),
			},
		},
	});

	return c.json({
		message: "Member IAM rule updated successfully",
		rule: updatedRule,
	});
});

const deleteMemberIamRule = createRoute({
	method: "delete",
	path: "/{organizationId}/members/{memberId}/iam/{ruleId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
			ruleId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Member IAM rule deleted successfully",
		},
	},
});

team.openapi(deleteMemberIamRule, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId, ruleId } = c.req.param();

	const { targetMember } = await requireMemberIamAccess(
		authUser.id,
		organizationId,
		memberId,
	);

	const [deletedRule] = await cdb
		.delete(tables.userIamRule)
		.where(
			and(
				eq(tables.userIamRule.id, ruleId),
				eq(tables.userIamRule.userOrganizationId, memberId),
			),
		)
		.returning();

	if (!deletedRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found",
		});
	}

	await logAuditEvent({
		organizationId,
		userId: authUser.id,
		action: "team_member.iam_rule.delete",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: {
			memberId,
			targetUserId: targetMember.userId,
			targetUserEmail: targetMember.user?.email,
			ruleType: deletedRule.ruleType,
			ruleValue: deletedRule.ruleValue,
		},
	});

	return c.json({
		message: "Member IAM rule deleted successfully",
	});
});

export default team;
