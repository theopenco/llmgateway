import { Hono } from "hono";

import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";

import { swrWrap } from "@llmgateway/cache";
import {
	cdb,
	eq,
	getTableName,
	project,
	projectHourlyStats,
	sql,
} from "@llmgateway/db";

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
	//
	// Pinned fixed-TTL cdb entry + SWR mirror: `project_hourly_stats` receives
	// no cdb-visible writes (the worker rewrites it outside cdb), so the
	// default auto-invalidating entry would just expire on its own short TTL
	// and re-run the full aggregate; a pinned TTL makes the staleness bound
	// explicit for this display-only figure.
	const totals = await swrWrap(
		`aisdkCredits:${organization.id}`,
		[getTableName(projectHourlyStats)],
		async () => {
			const rows = await cdb
				.select({
					totalUsed: sql<string>`coalesce(sum(${projectHourlyStats.creditsCost}::double precision), 0)::text`,
				})
				.from(projectHourlyStats)
				.innerJoin(project, eq(project.id, projectHourlyStats.projectId))
				.where(eq(project.organizationId, organization.id))
				.$withCache({
					tag: `aisdk-credits:${organization.id}`,
					autoInvalidate: false,
					config: { ex: 60 },
				});
			return rows[0];
		},
	);

	return c.json({
		balance: organization.credits,
		total_used: totals?.totalUsed ?? "0",
	});
});
