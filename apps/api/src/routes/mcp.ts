import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { getMcpUsage, getMcpUsageBreakdown } from "@/lib/mcp-usage.js";
import { userHasProjectAccess } from "@/utils/authorization.js";

import { db, getApiKeyCurrentPeriodState } from "@llmgateway/db";
import {
	mcpAccountSchema,
	mcpUsageInputSchema,
	mcpUsageBreakdownInputSchema,
	mcpUsageSchema,
	mcpUsageBreakdownSchema,
} from "@llmgateway/shared";
import { getApiKeyFingerprints } from "@llmgateway/shared/api-key-hash";

import type { z } from "zod";

export const mcp = new OpenAPIHono<{
	Variables: { mcpAccount: z.infer<typeof mcpAccountSchema> };
}>();

mcp.use("*", async (c, next) => {
	const authorization = c.req.header("Authorization");
	const token = authorization?.startsWith("Bearer ")
		? authorization.slice(7).trim()
		: c.req.header("x-api-key");
	if (!token) {
		throw new HTTPException(401, { message: "API key required." });
	}
	const key = await db.query.apiKey.findFirst({
		where: {
			tokenHash: { in: getApiKeyFingerprints(token) },
			status: "active",
			keyType: "user",
		},
		with: { project: { with: { organization: true } } },
	});
	if (!key || (key.expiresAt && key.expiresAt <= new Date())) {
		throw new HTTPException(401, {
			message: "A valid, active user API key is required.",
		});
	}
	const project = key.project;
	const organization = project?.organization;
	if (
		!project ||
		project.status !== "active" ||
		!organization ||
		organization.status !== "active" ||
		!(await userHasProjectAccess(key.createdBy, project.id))
	) {
		throw new HTTPException(403, {
			message: "The API key no longer has project access.",
		});
	}
	const member = await db.query.userOrganization.findFirst({
		where: { userId: key.createdBy, organizationId: organization.id },
	});
	const user = await db.query.user.findFirst({
		where: { id: key.createdBy },
		columns: { id: true, name: true },
	});
	if (!member || !user) {
		throw new HTTPException(403, {
			message: "Organization membership required.",
		});
	}
	const period = getApiKeyCurrentPeriodState(key);
	c.set("mcpAccount", {
		user,
		organization: {
			id: organization.id,
			name: organization.name,
			kind: organization.kind,
		},
		project: { id: project.id, name: project.name },
		role: member.role,
		usageScope: {
			type: member.role === "developer" ? "member" : "project",
			projectId: project.id,
			userId: member.role === "developer" ? key.createdBy : null,
		},
		apiKey: {
			id: key.id,
			name: key.description,
			usageUsd: Number(key.usage),
			usageLimitUsd: key.usageLimit === null ? null : Number(key.usageLimit),
			periodUsageUsd: Number(period.usage),
			periodUsageLimitUsd:
				key.periodUsageLimit === null ? null : Number(key.periodUsageLimit),
			periodStartedAt: period.startedAt?.toISOString() ?? null,
			expiresAt: key.expiresAt?.toISOString() ?? null,
		},
		creditsBalanceUsd:
			member.role === "developer" ? null : Number(organization.credits),
	});
	await next();
});

mcp.openapi(
	createRoute({
		method: "get",
		path: "/account",
		responses: {
			200: {
				description: "Connected MCP account and analytics scope",
				content: { "application/json": { schema: mcpAccountSchema } },
			},
		},
	}),
	(c) => c.json(c.get("mcpAccount")),
);

mcp.openapi(
	createRoute({
		method: "post",
		path: "/usage",
		request: {
			body: {
				required: true,
				content: { "application/json": { schema: mcpUsageInputSchema } },
			},
		},
		responses: {
			200: {
				description:
					"Scoped usage, costs, trends and most-used providers, models and apps",
				content: { "application/json": { schema: mcpUsageSchema } },
			},
		},
	}),
	async (c) =>
		c.json(
			await getMcpUsage(c.get("mcpAccount").usageScope, c.req.valid("json")),
		),
);

mcp.openapi(
	createRoute({
		method: "post",
		path: "/usage/breakdown",
		request: {
			body: {
				required: true,
				content: {
					"application/json": { schema: mcpUsageBreakdownInputSchema },
				},
			},
		},
		responses: {
			200: {
				description: "Ranked usage breakdown within the connected project",
				content: { "application/json": { schema: mcpUsageBreakdownSchema } },
			},
		},
	}),
	async (c) =>
		c.json(
			await getMcpUsageBreakdown(
				c.get("mcpAccount").usageScope,
				c.req.valid("json"),
			),
		),
);
