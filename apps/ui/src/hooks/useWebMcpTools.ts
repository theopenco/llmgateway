"use client";

import { useEffect, useRef } from "react";

import { getModelContext, type WebMcpToolDefinition } from "@/lib/webmcp";

/**
 * Registers WebMCP tools for as long as the calling component is mounted, so
 * a page only offers what it can currently do.
 */
export function useWebMcpTools(tools: WebMcpToolDefinition[]) {
	const latest = useRef(tools);
	useEffect(() => {
		latest.current = tools;
	});

	// Re-register only when what the agent sees changes, not on every render.
	const signature = JSON.stringify(
		tools.map((tool) => [
			tool.name,
			tool.title,
			tool.description,
			tool.inputSchema,
			tool.annotations,
		]),
	);

	useEffect(() => {
		const controller = new AbortController();
		const modelContext = getModelContext();
		for (const tool of latest.current) {
			modelContext
				.registerTool(
					{
						...tool,
						execute: async (input, options) => {
							const current = latest.current.find(
								(candidate) => candidate.name === tool.name,
							);
							return await (current ?? tool).execute(input, options);
						},
					},
					{ signal: controller.signal },
				)
				.catch((error: unknown) => {
					console.error(`Failed to register WebMCP tool ${tool.name}`, error);
				});
		}
		return () => controller.abort();
	}, [signature]);
}
