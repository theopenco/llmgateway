import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	createIamRuleSchema,
	iamRuleStatusEnum,
	iamRuleTypeEnum,
	iamRuleValueSchema,
	validateIamRuleInput,
} from "@/lib/iam-rules.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	apiKeyPeriodDurationUnits,
	cdb,
	db,
	eq,
	isValidApiKeyPeriodDuration,
	sql,
	tables,
} from "@llmgateway/db";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";

export const organizationTeams = new OpenAPIHono<ServerTypes>();

const periodUnitSchema = z.enum(apiKeyPeriodDurationUnits);
const budgetSchema = z.object({
	maxApiKeys: z.number().int().min(0).nullable(),
	usageLimit: z.string().nullable(),
	periodUsageLimit: z.string().nullable(),
	periodUsageDurationValue: z.number().int().positive().nullable(),
	periodUsageDurationUnit: periodUnitSchema.nullable(),
});
const projectSchema = z.object({ id: z.string(), name: z.string() });
const memberSchema = z.object({
	id: z.string(),
	userId: z.string(),
	name: z.string().nullable(),
	email: z.string(),
});
const iamRuleSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	teamId: z.string(),
	ruleType: iamRuleTypeEnum,
	ruleValue: iamRuleValueSchema,
	status: iamRuleStatusEnum,
});
const teamSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	budget: budgetSchema,
	projects: z.array(projectSchema),
	members: z.array(memberSchema),
	iamRules: z.array(iamRuleSchema),
});

const teamNameSchema = z.string().trim().min(1).max(100);

interface OrganizationAdminContext {
	membership: {
		role: "owner" | "admin" | "developer";
		organization: {
			id: string;
			plan: "free" | "pro" | "enterprise";
			kind: "default" | "chat" | "devpass";
		} | null;
	};
}

async function requireOrganizationAdmin(
	userId: string,
	organizationId: string,
): Promise<OrganizationAdminContext> {
	const membership = await db.query.userOrganization.findFirst({
		where: { userId: { eq: userId }, organizationId: { eq: organizationId } },
		with: { organization: { columns: { id: true, plan: true, kind: true } } },
	});
	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}
	if (
		membership.organization?.kind === "devpass" ||
		membership.organization?.kind === "chat"
	) {
		throw new HTTPException(403, {
			message:
				"Organization teams are not available for personal organizations",
		});
	}
	if (membership.role !== "owner" && membership.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage organization teams",
		});
	}
	return { membership };
}

function requireEnterprise(
	organizationId: string,
	organization: OrganizationAdminContext["membership"]["organization"],
): void {
	if (!hasOrganizationEnterpriseAccess(organizationId, organization?.plan)) {
		throw new HTTPException(403, {
			message: "Organization teams require the Enterprise plan",
		});
	}
}

function normalizeLimit(value: string | null): string | null {
	if (value === null) {
		return null;
	}
	const normalized = value.trim();
	if (
		!normalized ||
		!Number.isFinite(Number(normalized)) ||
		Number(normalized) < 0
	) {
		throw new HTTPException(400, {
			message: "Budget limits must be non-negative",
		});
	}
	return normalized;
}

function normalizeBudget(body: z.infer<typeof budgetSchema>) {
	const usageLimit = normalizeLimit(body.usageLimit);
	const periodUsageLimit = normalizeLimit(body.periodUsageLimit);
	const hasPeriod =
		periodUsageLimit !== null ||
		body.periodUsageDurationValue !== null ||
		body.periodUsageDurationUnit !== null;
	if (
		hasPeriod &&
		(periodUsageLimit === null ||
			body.periodUsageDurationValue === null ||
			body.periodUsageDurationUnit === null)
	) {
		throw new HTTPException(400, {
			message: "A period spend limit requires both a duration value and unit",
		});
	}
	if (
		hasPeriod &&
		!isValidApiKeyPeriodDuration(
			body.periodUsageDurationValue!,
			body.periodUsageDurationUnit!,
		)
	) {
		throw new HTTPException(400, { message: "Invalid period duration" });
	}
	return {
		maxApiKeys: body.maxApiKeys,
		usageLimit,
		periodUsageLimit,
		periodUsageDurationValue: hasPeriod ? body.periodUsageDurationValue : null,
		periodUsageDurationUnit: hasPeriod ? body.periodUsageDurationUnit : null,
	};
}

function budgetFromTeam(team: typeof tables.organizationTeam.$inferSelect) {
	return {
		maxApiKeys: team.maxApiKeys,
		usageLimit: team.usageLimit,
		periodUsageLimit: team.periodUsageLimit,
		periodUsageDurationValue: team.periodUsageDurationValue,
		periodUsageDurationUnit: team.periodUsageDurationUnit,
	};
}

async function loadTeam(organizationId: string, teamId: string) {
	const team = await db.query.organizationTeam.findFirst({
		where: { id: { eq: teamId }, organizationId: { eq: organizationId } },
		with: {
			projects: { with: { project: { columns: { id: true, name: true } } } },
			members: {
				with: { user: { columns: { id: true, name: true, email: true } } },
			},
			iamRules: true,
		},
	});
	if (!team) {
		throw new HTTPException(404, { message: "Team not found" });
	}
	return {
		id: team.id,
		name: team.name,
		createdAt: team.createdAt,
		updatedAt: team.updatedAt,
		budget: budgetFromTeam(team),
		projects: team.projects
			.filter((entry) => entry.project)
			.map((entry) => entry.project!),
		members: team.members.map((member) => ({
			id: member.id,
			userId: member.userId,
			name: member.user?.name ?? null,
			email: member.user!.email,
		})),
		iamRules: team.iamRules,
	};
}

async function assertUniqueName(
	organizationId: string,
	name: string,
	excludeTeamId?: string,
) {
	const existing = await db
		.select({ id: tables.organizationTeam.id })
		.from(tables.organizationTeam)
		.where(
			and(
				eq(tables.organizationTeam.organizationId, organizationId),
				sql`lower(${tables.organizationTeam.name}) = lower(${name})`,
			),
		);
	if (existing.some((team) => team.id !== excludeTeamId)) {
		throw new HTTPException(409, {
			message: "A team with this name already exists",
		});
	}
}

const listTeams = createRoute({
	method: "get",
	path: "/{organizationId}/teams",
	request: { params: z.object({ organizationId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ teams: z.array(teamSchema) }),
				},
			},
			description: "Organization teams",
		},
	},
});
organizationTeams.openapi(listTeams, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId } = c.req.param();
	await requireOrganizationAdmin(user.id, organizationId);
	const rows = await db.query.organizationTeam.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true },
		orderBy: { name: "asc" },
	});
	return c.json({
		teams: await Promise.all(
			rows.map((row) => loadTeam(organizationId, row.id)),
		),
	});
});

const createTeam = createRoute({
	method: "post",
	path: "/{organizationId}/teams",
	request: {
		params: z.object({ organizationId: z.string() }),
		body: {
			content: {
				"application/json": { schema: z.object({ name: teamNameSchema }) },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ team: teamSchema }) },
			},
			description: "Team created",
		},
	},
});
organizationTeams.openapi(createTeam, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	const name = c.req.valid("json").name.trim();
	await assertUniqueName(organizationId, name);
	const [team] = await cdb
		.insert(tables.organizationTeam)
		.values({ organizationId, name })
		.returning();
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.create",
		resourceType: "organization_team",
		resourceId: team.id,
		metadata: { resourceName: name },
	});
	return c.json({ team: await loadTeam(organizationId, team.id) });
});

const getTeam = createRoute({
	method: "get",
	path: "/{organizationId}/teams/{teamId}",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ team: teamSchema }) },
			},
			description: "Team",
		},
	},
});
organizationTeams.openapi(getTeam, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	await requireOrganizationAdmin(user.id, organizationId);
	return c.json({ team: await loadTeam(organizationId, teamId) });
});

const updateTeam = createRoute({
	method: "patch",
	path: "/{organizationId}/teams/{teamId}",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
		body: {
			content: {
				"application/json": { schema: z.object({ name: teamNameSchema }) },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ team: teamSchema }) },
			},
			description: "Team updated",
		},
	},
});
organizationTeams.openapi(updateTeam, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	const current = await loadTeam(organizationId, teamId);
	const name = c.req.valid("json").name.trim();
	await assertUniqueName(organizationId, name, teamId);
	await cdb
		.update(tables.organizationTeam)
		.set({ name })
		.where(eq(tables.organizationTeam.id, teamId));
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.update",
		resourceType: "organization_team",
		resourceId: teamId,
		metadata: { changes: { name: { old: current.name, new: name } } },
	});
	return c.json({ team: await loadTeam(organizationId, teamId) });
});

const deleteTeam = createRoute({
	method: "delete",
	path: "/{organizationId}/teams/{teamId}",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Team deleted",
		},
	},
});
organizationTeams.openapi(deleteTeam, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	await requireOrganizationAdmin(user.id, organizationId);
	const team = await loadTeam(organizationId, teamId);
	if (team.members.length) {
		throw new HTTPException(409, {
			message: "Remove all members before deleting this team",
		});
	}
	await cdb
		.delete(tables.organizationTeam)
		.where(eq(tables.organizationTeam.id, teamId));
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.delete",
		resourceType: "organization_team",
		resourceId: teamId,
		metadata: { resourceName: team.name },
	});
	return c.json({ message: "Team deleted" });
});

const replaceProjects = createRoute({
	method: "put",
	path: "/{organizationId}/teams/{teamId}/projects",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ projectIds: z.array(z.string()) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ team: teamSchema }) },
			},
			description: "Team projects updated",
		},
	},
});
organizationTeams.openapi(replaceProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	const current = await loadTeam(organizationId, teamId);
	const projectIds = [...new Set(c.req.valid("json").projectIds)];
	const projects = projectIds.length
		? await db.query.project.findMany({
				where: {
					id: { in: projectIds },
					organizationId: { eq: organizationId },
					status: { ne: "deleted" },
				},
				columns: { id: true },
			})
		: [];
	if (projects.length !== projectIds.length) {
		throw new HTTPException(400, {
			message: "One or more projects do not belong to this organization",
		});
	}
	await cdb.transaction(async (tx) => {
		await tx
			.delete(tables.organizationTeamProject)
			.where(eq(tables.organizationTeamProject.teamId, teamId));
		if (projectIds.length) {
			await tx
				.insert(tables.organizationTeamProject)
				.values(projectIds.map((projectId) => ({ teamId, projectId })));
		}
	});
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.projects_update",
		resourceType: "organization_team",
		resourceId: teamId,
		metadata: {
			changes: {
				projectIds: {
					old: current.projects.map((project) => project.id),
					new: projectIds,
				},
			},
		},
	});
	return c.json({ team: await loadTeam(organizationId, teamId) });
});

const updateBudget = createRoute({
	method: "put",
	path: "/{organizationId}/teams/{teamId}/budget",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
		body: { content: { "application/json": { schema: budgetSchema } } },
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ team: teamSchema }) },
			},
			description: "Team budget updated",
		},
	},
});
organizationTeams.openapi(updateBudget, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	const current = await loadTeam(organizationId, teamId);
	const budget = normalizeBudget(c.req.valid("json"));
	await cdb
		.update(tables.organizationTeam)
		.set(budget)
		.where(
			and(
				eq(tables.organizationTeam.id, teamId),
				eq(tables.organizationTeam.organizationId, organizationId),
			),
		);
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.budget_update",
		resourceType: "organization_team",
		resourceId: teamId,
		metadata: { changes: { budget: { old: current.budget, new: budget } } },
	});
	return c.json({ team: await loadTeam(organizationId, teamId) });
});

const assignMember = createRoute({
	method: "put",
	path: "/{organizationId}/members/{memberId}/team",
	request: {
		params: z.object({ organizationId: z.string(), memberId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ teamId: z.string().nullable() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Member team updated",
		},
	},
});
organizationTeams.openapi(assignMember, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, memberId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	const { teamId } = c.req.valid("json");
	const member = await db.query.userOrganization.findFirst({
		where: { id: { eq: memberId }, organizationId: { eq: organizationId } },
		columns: { id: true, userId: true, role: true, teamId: true },
	});
	if (!member) {
		throw new HTTPException(404, { message: "Member not found" });
	}
	if (teamId) {
		requireEnterprise(organizationId, membership.organization);
		if (member.role !== "developer") {
			throw new HTTPException(400, {
				message: "Only developers can belong to an organization team",
			});
		}
		await loadTeam(organizationId, teamId);
	}
	await cdb
		.update(tables.userOrganization)
		.set({ teamId })
		.where(eq(tables.userOrganization.id, memberId));
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: teamId
			? "organization_team.member_assign"
			: "organization_team.member_unassign",
		resourceType: "organization_team",
		resourceId: teamId ?? member.teamId ?? undefined,
		metadata: {
			targetUserId: member.userId,
			changes: { teamId: { old: member.teamId, new: teamId } },
		},
	});
	return c.json({
		message: teamId ? "Member assigned to team" : "Member removed from team",
	});
});

const listIamRules = createRoute({
	method: "get",
	path: "/{organizationId}/teams/{teamId}/iam",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ rules: z.array(iamRuleSchema) }),
				},
			},
			description: "Team IAM rules",
		},
	},
});
organizationTeams.openapi(listIamRules, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	await requireOrganizationAdmin(user.id, organizationId);
	const team = await loadTeam(organizationId, teamId);
	return c.json({ rules: team.iamRules });
});

const createIamRule = createRoute({
	method: "post",
	path: "/{organizationId}/teams/{teamId}/iam",
	request: {
		params: z.object({ organizationId: z.string(), teamId: z.string() }),
		body: { content: { "application/json": { schema: createIamRuleSchema } } },
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ rule: iamRuleSchema }) },
			},
			description: "Team IAM rule created",
		},
	},
});
organizationTeams.openapi(createIamRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	await loadTeam(organizationId, teamId);
	const data = c.req.valid("json");
	validateIamRuleInput(data);
	const [rule] = await cdb
		.insert(tables.organizationTeamIamRule)
		.values({ teamId, ...data })
		.returning();
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.iam_rule.create",
		resourceType: "iam_rule",
		resourceId: rule.id,
		metadata: { teamId, ruleType: rule.ruleType, ruleValue: rule.ruleValue },
	});
	return c.json({ rule });
});

const updateIamRule = createRoute({
	method: "patch",
	path: "/{organizationId}/teams/{teamId}/iam/{ruleId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			teamId: z.string(),
			ruleId: z.string(),
		}),
		body: {
			content: {
				"application/json": { schema: createIamRuleSchema.partial() },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ rule: iamRuleSchema }) },
			},
			description: "Team IAM rule updated",
		},
	},
});
organizationTeams.openapi(updateIamRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId, ruleId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	await loadTeam(organizationId, teamId);
	const current = await db.query.organizationTeamIamRule.findFirst({
		where: { id: { eq: ruleId }, teamId: { eq: teamId } },
	});
	if (!current) {
		throw new HTTPException(404, { message: "IAM rule not found" });
	}
	const update = c.req.valid("json");
	validateIamRuleInput({
		ruleType: update.ruleType ?? current.ruleType,
		ruleValue: update.ruleValue ?? current.ruleValue,
	});
	let rule = current;
	if (Object.keys(update).length) {
		[rule] = await cdb
			.update(tables.organizationTeamIamRule)
			.set(update)
			.where(eq(tables.organizationTeamIamRule.id, ruleId))
			.returning();
	}
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.iam_rule.update",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: { teamId, changes: { rule: { old: current, new: rule } } },
	});
	return c.json({ rule });
});

const deleteIamRule = createRoute({
	method: "delete",
	path: "/{organizationId}/teams/{teamId}/iam/{ruleId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			teamId: z.string(),
			ruleId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Team IAM rule deleted",
		},
	},
});
organizationTeams.openapi(deleteIamRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId, teamId, ruleId } = c.req.param();
	const { membership } = await requireOrganizationAdmin(
		user.id,
		organizationId,
	);
	requireEnterprise(organizationId, membership.organization);
	await loadTeam(organizationId, teamId);
	const [rule] = await cdb
		.delete(tables.organizationTeamIamRule)
		.where(
			and(
				eq(tables.organizationTeamIamRule.id, ruleId),
				eq(tables.organizationTeamIamRule.teamId, teamId),
			),
		)
		.returning();
	if (!rule) {
		throw new HTTPException(404, { message: "IAM rule not found" });
	}
	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "organization_team.iam_rule.delete",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: { teamId, ruleType: rule.ruleType, ruleValue: rule.ruleValue },
	});
	return c.json({ message: "IAM rule deleted" });
});
