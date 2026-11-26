import { HTTPException } from "hono/http-exception";

import { findApiKeyByToken } from "@/lib/cached-queries.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { getModelsAccess } from "@/models/model-access.js";

import { isIpAllowedByIamRules } from "@llmgateway/shared/client-ip";

import type { Context } from "hono";

export async function getAuthenticatedReadAccess(
	c: Context,
	suppliedToken?: string,
) {
	const token = suppliedToken ?? extractApiToken(c);
	const key = await findApiKeyByToken(token);
	if (!key || key.status !== "active") {
		throw new HTTPException(401, { message: "Invalid API key" });
	}
	if (key.keyType !== "user" || key.endUserSession) {
		throw new HTTPException(403, {
			message: "This endpoint requires a regular API key",
		});
	}
	// Read metadata even when quota is exhausted, but keep credential, tenant
	// and source-IP checks identical to authenticated model discovery.
	const access = await getModelsAccess(c, token);
	if (!access) {
		throw new HTTPException(401, { message: "No API key provided" });
	}
	for (const rules of [
		access.iamRules.team,
		access.iamRules.member,
		access.iamRules.key,
	]) {
		if (!isIpAllowedByIamRules(rules, access.clientIp)) {
			throw new HTTPException(403, {
				message: "Access denied by an IP restriction",
			});
		}
	}
	return access;
}
