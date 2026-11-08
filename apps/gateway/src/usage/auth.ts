import { HTTPException } from "hono/http-exception";

import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	memberHasEffectiveProjectAccess,
} from "@/lib/cached-queries.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { assertOrganizationUsable } from "@/lib/organization-access.js";

import type { Context } from "hono";

export async function authenticateUsageProject(c: Context): Promise<string> {
	c.header("Cache-Control", "private, no-store");
	c.header("Vary", "Authorization, x-api-key");
	const key = await findApiKeyByToken(extractApiToken(c));
	if (
		!key ||
		key.status !== "active" ||
		(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now())
	) {
		throw new HTTPException(401, { message: "Invalid or inactive API key" });
	}
	if (key.keyType !== "user" || key.endUserSession) {
		throw new HTTPException(403, {
			message: "Usage receipts require a regular project API key",
		});
	}
	const project = await findProjectById(key.projectId);
	if (!project || project.status === "deleted") {
		throw new HTTPException(404, { message: "Project not found" });
	}
	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	assertOrganizationUsable(organization);
	if (
		!(await memberHasEffectiveProjectAccess(
			key.createdBy,
			project.organizationId,
			key.projectId,
		))
	) {
		throw new HTTPException(403, { message: "Project access is required" });
	}
	return project.id;
}
