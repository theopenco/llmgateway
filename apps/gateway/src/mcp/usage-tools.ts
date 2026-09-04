import { z } from "zod";

import { logger, toError } from "@llmgateway/logger";
import {
	mcpAccountSchema,
	mcpUsageInputSchema,
	mcpUsageBreakdownInputSchema,
	mcpUsageSchema,
	mcpUsageBreakdownSchema,
} from "@llmgateway/shared";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

async function requestUsage<T extends Record<string, unknown>>(
	apiKey: string,
	path: string,
	schema: z.ZodType<T>,
	input?: unknown,
): Promise<CallToolResult> {
	try {
		const baseUrl =
			process.env.API_URL ??
			(process.env.NODE_ENV === "production"
				? "https://internal.llmgateway.io"
				: "http://localhost:4002");
		const response = await fetch(new URL(`/mcp/${path}`, baseUrl), {
			method: input === undefined ? "GET" : "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: input === undefined ? undefined : JSON.stringify(input),
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			const error =
				response.status === 401
					? "A valid, active user API key is required."
					: response.status === 403
						? "This API key does not have access to the connected project's analytics."
						: response.status === 400
							? "Invalid usage parameters. Use an ordered UTC date range of at most 366 days (31 for hourly reports)."
							: "Usage data is temporarily unavailable. Please try again.";
			logger.warn("MCP analytics request failed", {
				path,
				status: response.status,
			});
			return { content: [{ type: "text", text: error }], isError: true };
		}
		const data = schema.parse(await response.json());
		return {
			content: [{ type: "text", text: JSON.stringify(data) }],
			structuredContent: data,
		};
	} catch (error) {
		logger.error("MCP analytics tool error", toError(error));
		return {
			content: [
				{
					type: "text",
					text: "Usage data is temporarily unavailable. Please try again.",
				},
			],
			isError: true,
		};
	}
}

export function registerUsageTools(server: McpServer, apiKey: string) {
	const annotations = {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	};
	server.registerTool(
		"get-account",
		{
			description:
				"Get the connected user, project, organization, role, analytics scope, API key spend limits and organization credit balance (owners/admins only). No secrets are returned. Use this before interpreting 'my usage': owners/admins see the connected project; developers see their own keys in that project.",
			inputSchema: z.object({}).strict(),
			outputSchema: mcpAccountSchema,
			annotations,
		},
		async () => await requestUsage(apiKey, "account", mcpAccountSchema),
	);
	server.registerTool(
		"get-usage",
		{
			description:
				"Get the connected user's scoped request/token totals, inference costs in USD (credits and BYOK separately), storage costs, hourly/daily trends and most-used provider, model and coding agent/app by request count. Defaults to the last 30 UTC dates. Uses hourly aggregates, so recent requests may lag; empty periods have zero totals and null rankings. Check appUsageCoverage before interpreting incomplete app history. Read-only; no generation charges.",
			inputSchema: mcpUsageInputSchema,
			outputSchema: mcpUsageSchema,
			annotations,
		},
		async (input) => await requestUsage(apiKey, "usage", mcpUsageSchema, input),
	);
	server.registerTool(
		"get-usage-breakdown",
		{
			description:
				"Rank usage by actual provider, model, coding agent/app, or API key within the connected user's analytics scope. Sort by requests, inference cost, or tokens, with pagination. Costs are USD usage estimates, not invoice totals. App IDs come from request source attribution; 'unknown' means no source was recorded. Check coverage for incomplete historical breakdowns. Read-only; no generation charges.",
			inputSchema: mcpUsageBreakdownInputSchema,
			outputSchema: mcpUsageBreakdownSchema,
			annotations,
		},
		async (input) =>
			await requestUsage(
				apiKey,
				"usage/breakdown",
				mcpUsageBreakdownSchema,
				input,
			),
	);
}
