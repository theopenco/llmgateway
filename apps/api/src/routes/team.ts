import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { logAuditEvent } from "@llmgateway/audit";
import {
	addApiKeyPeriodDuration,
	and,
	apiKeyPeriodDurationUnits,
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
						// The org-wide default developer budget (owner/admin only).
						defaultDeveloperBudget: memberBudgetSchema.nullable(),
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

	const org = isPrivileged
		? await db.query.organization.findFirst({
				where: { id: { eq: organizationId } },
				columns: {
					defaultDeveloperMaxApiKeys: true,
					defaultDeveloperUsageLimit: true,
					defaultDeveloperPeriodUsageLimit: true,
					defaultDeveloperPeriodUsageDurationValue: true,
					defaultDeveloperPeriodUsageDurationUnit: true,
				},
			})
		: null;
	const orgDefaults = orgDefaultsFrom(org);

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
		defaultDeveloperBudget: isPrivileged
			? defaultBudgetFrom(orgDefaults)
			: null,
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
						member: teamMemberSchema.openapi({}),
					}),
				},
			},
			description: "Member added successfully",
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

	const memberLimit =
		userOrganization.organization?.plan === "enterprise" ? 100 : 5;

	if (currentMembers.length >= memberLimit) {
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

	const targetUser = await db.query.user.findFirst({
		where: {
			email: {
				eq: email,
			},
		},
	});

	if (!targetUser) {
		throw new HTTPException(404, {
			message: "User not found. Please ask them to create an account first.",
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

export default team;
