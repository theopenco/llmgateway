import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";

import {
	assertOrganizationSkillAccess,
	organizationSkillSchema,
	parseOrganizationSkill,
	serializeOrganizationSkill,
	skillContentSchema,
	skillSummarySchema,
	skillSummaryColumns,
	summarizeOrganizationSkill,
} from "@/lib/organization-skills.js";

import { logAuditEvent } from "@llmgateway/audit";
import { and, db, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const organizationSkills = new OpenAPIHono<ServerTypes>();
for (const path of ["/:organizationId/skills", "/:organizationId/skills/*"]) {
	organizationSkills.use(path, async (c, next) => {
		c.header("Cache-Control", "private, no-store");
		await next();
	});
	organizationSkills.use(path, bodyLimit({ maxSize: 6 * 1024 * 1024 }));
}

const orgParams = z.object({ organizationId: z.string() });
const skillParams = orgParams.extend({ id: z.string() });
const skillResponse = {
	content: {
		"application/json": {
			schema: z.object({ skill: organizationSkillSchema }),
		},
	},
	description: "Organization skill",
};

organizationSkills.openapi(
	createRoute({
		method: "get",
		path: "/{organizationId}/skills",
		request: { params: orgParams },
		responses: {
			200: {
				content: {
					"application/json": {
						schema: z.object({ skills: z.array(skillSummarySchema) }),
					},
				},
				description: "Organization skills",
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		await assertOrganizationSkillAccess(c, organizationId);
		const skills = await db.query.organizationSkill.findMany({
			columns: skillSummaryColumns,
			where: { organizationId: { eq: organizationId } },
			orderBy: { name: "asc" },
		});
		return c.json({ skills: skills.map(summarizeOrganizationSkill) });
	},
);

organizationSkills.openapi(
	createRoute({
		method: "post",
		path: "/{organizationId}/skills",
		request: {
			params: orgParams,
			body: {
				content: { "application/json": { schema: skillContentSchema } },
				required: true,
			},
		},
		responses: { 201: skillResponse },
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const user = await assertOrganizationSkillAccess(c, organizationId, true);
		const body = c.req.valid("json");
		const metadata = parseOrganizationSkill(body.content);
		const [skill] = await db
			.insert(tables.organizationSkill)
			.values({ organizationId, ...body, ...metadata })
			.onConflictDoNothing()
			.returning();
		if (!skill) {
			throw new HTTPException(409, {
				message: "A skill with this name already exists in the organization",
			});
		}
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "organization_skill.create",
			resourceType: "organization_skill",
			resourceId: skill.id,
		});
		return c.json({ skill: serializeOrganizationSkill(skill) }, 201);
	},
);

organizationSkills.openapi(
	createRoute({
		method: "get",
		path: "/{organizationId}/skills/{id}",
		request: { params: skillParams },
		responses: { 200: skillResponse },
	}),
	async (c) => {
		const { organizationId, id } = c.req.valid("param");
		await assertOrganizationSkillAccess(c, organizationId);
		const skill = await db.query.organizationSkill.findFirst({
			where: { organizationId: { eq: organizationId }, id: { eq: id } },
		});
		if (!skill) {
			throw new HTTPException(404, { message: "Skill not found" });
		}
		return c.json({ skill: serializeOrganizationSkill(skill) });
	},
);

organizationSkills.openapi(
	createRoute({
		method: "put",
		path: "/{organizationId}/skills/{id}",
		request: {
			params: skillParams,
			body: {
				content: { "application/json": { schema: skillContentSchema } },
				required: true,
			},
		},
		responses: { 200: skillResponse },
	}),
	async (c) => {
		const { organizationId, id } = c.req.valid("param");
		const user = await assertOrganizationSkillAccess(c, organizationId, true);
		const body = c.req.valid("json");
		const metadata = parseOrganizationSkill(body.content);
		const existing = await db.query.organizationSkill.findFirst({
			where: { organizationId: { eq: organizationId }, id: { eq: id } },
		});
		if (!existing) {
			throw new HTTPException(404, { message: "Skill not found" });
		}
		if (metadata.name !== existing.name) {
			throw new HTTPException(400, {
				message:
					"Keep the skill name unchanged; create a new skill to rename it",
			});
		}
		const [skill] = await db
			.update(tables.organizationSkill)
			.set({ ...body, ...metadata })
			.where(
				and(
					eq(tables.organizationSkill.organizationId, organizationId),
					eq(tables.organizationSkill.id, id),
				),
			)
			.returning();
		if (!skill) {
			throw new HTTPException(404, { message: "Skill not found" });
		}
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "organization_skill.update",
			resourceType: "organization_skill",
			resourceId: id,
		});
		return c.json({ skill: serializeOrganizationSkill(skill) });
	},
);

organizationSkills.openapi(
	createRoute({
		method: "patch",
		path: "/{organizationId}/skills/{id}",
		request: {
			params: skillParams,
			body: {
				content: {
					"application/json": { schema: z.object({ enabled: z.boolean() }) },
				},
				required: true,
			},
		},
		responses: { 200: skillResponse },
	}),
	async (c) => {
		const { organizationId, id } = c.req.valid("param");
		const user = await assertOrganizationSkillAccess(c, organizationId, true);
		const [skill] = await db
			.update(tables.organizationSkill)
			.set(c.req.valid("json"))
			.where(
				and(
					eq(tables.organizationSkill.organizationId, organizationId),
					eq(tables.organizationSkill.id, id),
				),
			)
			.returning();
		if (!skill) {
			throw new HTTPException(404, { message: "Skill not found" });
		}
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "organization_skill.update",
			resourceType: "organization_skill",
			resourceId: id,
			metadata: { enabled: skill.enabled },
		});
		return c.json({ skill: serializeOrganizationSkill(skill) });
	},
);

organizationSkills.openapi(
	createRoute({
		method: "delete",
		path: "/{organizationId}/skills/{id}",
		request: { params: skillParams },
		responses: {
			200: {
				content: {
					"application/json": { schema: z.object({ success: z.boolean() }) },
				},
				description: "Skill deleted",
			},
		},
	}),
	async (c) => {
		const { organizationId, id } = c.req.valid("param");
		const user = await assertOrganizationSkillAccess(c, organizationId, true);
		const [skill] = await db
			.delete(tables.organizationSkill)
			.where(
				and(
					eq(tables.organizationSkill.organizationId, organizationId),
					eq(tables.organizationSkill.id, id),
				),
			)
			.returning({ id: tables.organizationSkill.id });
		if (!skill) {
			throw new HTTPException(404, { message: "Skill not found" });
		}
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "organization_skill.delete",
			resourceType: "organization_skill",
			resourceId: id,
		});
		return c.json({ success: true });
	},
);
