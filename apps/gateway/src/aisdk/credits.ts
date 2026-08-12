import { Hono } from "hono";

import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";

import { cdb, eq, project, projectHourlyStats, sql } from "@llmgateway/db";

import { buildGatewayErrorBody } from "./errors.js";

import type { ServerTypes } from "@/vars.js";

/**
 * `GET /v1/credits`, backing `gateway.getCredits()`.
 *
 * `@ai-sdk/gateway` resolves this against the base URL's *origin* rather than
 * its path, which is why it is mounted under `/v1` next to the OpenAI-compatible
 * routes instead of alongside `/v4/ai/language-model`.
 */
export const creditsRoute = new Hono<ServerTypes>();

creditsRoute.get("/", async (c) => {
	const [scheme, token] = (c.req.header("Authorization") ?? "").split(" ");

	if (scheme?.toLowerCase() !== "bearer" || !token) {
		return c.json(
			buildGatewayErrorBody({ status: 401, message: "No API key provided" }),
			401,
		);
	}

	const apiKey = await findApiKeyByToken(token);
	if (!apiKey || apiKey.status !== "active") {
		return c.json(
			buildGatewayErrorBody({
				status: 401,
				message: "API key not found or inactive",
			}),
			401,
		);
	}

	const apiKeyProject = await findProjectById(apiKey.projectId);
	const organization = apiKeyProject
		? await findOrganizationById(apiKeyProject.organizationId)
		: null;

	if (!organization) {
		return c.json(
			buildGatewayErrorBody({
				status: 500,
				message: "Could not resolve the organization for this API key",
			}),
			500,
		);
	}

	// Aggregation table, not `log`: the per-request table is pruned by data
	// retention, so summing it under-reports for organizations with retention
	// off. `credits_cost` is float4 — summing it in float4 drifts at scale, so
	// the cast to double precision happens before the sum.
	const [totals] = await cdb
		.select({
			totalUsed: sql<string>`coalesce(sum(${projectHourlyStats.creditsCost}::double precision), 0)::text`,
		})
		.from(projectHourlyStats)
		.innerJoin(project, eq(project.id, projectHourlyStats.projectId))
		.where(eq(project.organizationId, organization.id));

	return c.json({
		balance: organization.credits,
		total_used: totals?.totalUsed ?? "0",
	});
});
