import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import { logAuditEvent } from "@llmgateway/audit";
import { and, db, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminSdkAccess = new OpenAPIHono<ServerTypes>();
adminSdkAccess.use("/*", adminMiddleware);

const path = "/organizations/{orgId}/projects/{projectId}/payments-sdk";
const params = z.object({ orgId: z.string(), projectId: z.string() });
const response = z.object({ paymentsSdkEnabled: z.boolean() });

async function requireProject(orgId: string, projectId: string) {
	const organization = await db.query.organization.findFirst({
		where: { id: orgId },
	});
	if (!organization || organization.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	const project = await db.query.project.findFirst({
		where: { id: projectId, organizationId: orgId },
	});
	if (!project || project.status === "deleted") {
		throw new HTTPException(404, { message: "Project not found" });
	}
	return project;
}

adminSdkAccess.openapi(
	createRoute({
		method: "get",
		path,
		request: { params },
		responses: {
			200: {
				description: "Payments SDK setup access.",
				content: { "application/json": { schema: response } },
			},
		},
	}),
	async (c) => {
		const { orgId, projectId } = c.req.valid("param");
		const project = await requireProject(orgId, projectId);
		return c.json({ paymentsSdkEnabled: project.paymentsSdkEnabled });
	},
);

adminSdkAccess.openapi(
	createRoute({
		method: "patch",
		path,
		request: {
			params,
			body: { content: { "application/json": { schema: response } } },
		},
		responses: {
			200: {
				description: "Payments SDK setup access updated.",
				content: { "application/json": { schema: response } },
			},
		},
	}),
	async (c) => {
		const { orgId, projectId } = c.req.valid("param");
		const { paymentsSdkEnabled } = c.req.valid("json");
		const project = await requireProject(orgId, projectId);
		await db
			.update(tables.project)
			.set({ paymentsSdkEnabled })
			.where(
				and(
					eq(tables.project.id, projectId),
					eq(tables.project.organizationId, orgId),
				),
			);
		await logAuditEvent({
			organizationId: orgId,
			userId: c.get("user")!.id,
			action: "project.update",
			resourceType: "project",
			resourceId: projectId,
			metadata: {
				changes: {
					paymentsSdkEnabled: {
						old: project.paymentsSdkEnabled,
						new: paymentsSdkEnabled,
					},
				},
			},
		});
		return c.json({ paymentsSdkEnabled });
	},
);
