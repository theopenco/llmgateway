import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import {
	organizationSkillSchema,
	serializeOrganizationSkill,
	skillNameSchema,
	skillSummarySchema,
	skillSummaryColumns,
	summarizeOrganizationSkill,
} from "@/lib/organization-skills.js";
import { userHasProjectAccess } from "@/utils/authorization.js";

import { db } from "@llmgateway/db";
import { getApiKeyFingerprints } from "@llmgateway/shared/api-key-hash";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

export const cliSkills = new OpenAPIHono<{
	Variables: { skillOrganizationId: string };
}>();

cliSkills.openAPIRegistry.registerComponent(
	"securitySchemes",
	"organizationSkillKey",
	{
		type: "http",
		scheme: "bearer",
		description: "A regular project API key from the enterprise organization",
	},
);

const deniedResponse = {
	description: "Skill access denied",
	content: {
		"application/json": {
			schema: z.object({
				error: z.boolean(),
				status: z.number(),
				message: z.string(),
			}),
		},
	},
};

cliSkills.use("/*", async (c, next) => {
	c.header("Cache-Control", "private, no-store");
	const authorization = c.req.header("Authorization");
	const token = authorization?.startsWith("Bearer ")
		? authorization.slice(7).trim()
		: "";
	if (!token) {
		throw new HTTPException(401, { message: "A project API key is required" });
	}
	const key = await db.query.apiKey.findFirst({
		where: {
			tokenHash: { in: getApiKeyFingerprints(token) },
			keyType: { eq: "user" },
			kind: { eq: "regular" },
			status: { eq: "active" },
		},
		with: { project: { with: { organization: true } }, creator: true },
	});
	if (
		!key ||
		(key.expiresAt && key.expiresAt.getTime() <= Date.now()) ||
		key.creator?.status !== "active"
	) {
		throw new HTTPException(401, { message: "Invalid or expired API key" });
	}
	const organization = key.project?.organization;
	if (
		key.project?.status !== "active" ||
		organization?.status !== "active" ||
		!(await userHasProjectAccess(key.createdBy, key.projectId))
	) {
		throw new HTTPException(403, {
			message: "Project access is no longer available",
		});
	}
	if (!hasOrganizationEnterpriseAccess(organization.id, organization.plan)) {
		throw new HTTPException(403, {
			message: "Organization skills require an enterprise plan",
		});
	}
	c.set("skillOrganizationId", organization.id);
	await next();
});

cliSkills.openapi(
	createRoute({
		method: "get",
		path: "/",
		security: [{ organizationSkillKey: [] }],
		responses: {
			401: deniedResponse,
			403: deniedResponse,
			200: {
				content: {
					"application/json": {
						schema: z.object({ skills: z.array(skillSummarySchema) }),
					},
				},
				description: "Enabled skills for the API key's organization",
			},
		},
	}),
	async (c) => {
		const skills = await db.query.organizationSkill.findMany({
			columns: skillSummaryColumns,
			where: {
				organizationId: { eq: c.get("skillOrganizationId") },
				enabled: { eq: true },
			},
			orderBy: { name: "asc" },
		});
		return c.json({ skills: skills.map(summarizeOrganizationSkill) }, 200);
	},
);

cliSkills.openapi(
	createRoute({
		method: "get",
		path: "/{name}",
		security: [{ organizationSkillKey: [] }],
		request: { params: z.object({ name: skillNameSchema }) },
		responses: {
			401: deniedResponse,
			403: deniedResponse,
			404: deniedResponse,
			200: {
				content: {
					"application/json": {
						schema: z.object({ skill: organizationSkillSchema }),
					},
				},
				description: "SKILL.md content and supporting files",
			},
		},
	}),
	async (c) => {
		const { name } = c.req.valid("param");
		const skill = await db.query.organizationSkill.findFirst({
			where: {
				organizationId: { eq: c.get("skillOrganizationId") },
				enabled: { eq: true },
				name: { eq: name },
			},
		});
		if (!skill) {
			throw new HTTPException(404, { message: "Skill not found" });
		}
		return c.json({ skill: serializeOrganizationSkill(skill) }, 200);
	},
);
