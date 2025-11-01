import { experimental_createMCPClient } from "@ai-sdk/mcp";

import type { experimental_MCPClient } from "@ai-sdk/mcp";
// import type { Tool } from "ai";

let cachedClient: experimental_MCPClient | null = null;
let cachedTools: Record<string, any> | null = null;

export async function getGithubMcpTools(
	githubToken?: string,
): Promise<{ tools: Record<string, any>; client: experimental_MCPClient }> {
	if (cachedTools) {
		return {
			tools: cachedTools,
			client: cachedClient as experimental_MCPClient,
		};
	}

	const token =
		githubToken || process.env.GITHUB_MCP_TOKEN || process.env.GITHUB_TOKEN;

	if (!token) {
		throw new Error(
			"Missing GitHub MCP token. Set GITHUB_MCP_TOKEN or GITHUB_TOKEN.",
		);
	}

	if (!cachedClient) {
		const mcpClient = await experimental_createMCPClient({
			transport: {
				type: "http",
				url: "https://api.githubcopilot.com/mcp",

				headers: { Authorization: `Bearer ${token}` },
			},
		});
		const tools = await mcpClient.tools();
		if (!tools) {
			throw new Error("No tools found");
		}

		cachedClient = mcpClient;

		// Wrap write-like tools to require human approval
		// const needsApprovalPattern =
		// 	/create|update|delete|close|merge|write|push|label|assign|comment|open|reopen/i;
		// const wrapped: Record<string, Tool> = {};
		// for (const [name, def] of Object.entries(tools)) {
		// 	if (needsApprovalPattern.test(name)) {
		// 		wrapped[name] = { ...def, needsApproval: true };
		// 	} else {
		// 		wrapped[name] = def;
		// 	}
		// }

		cachedTools = tools;
	}

	return { tools: cachedTools ?? {}, client: cachedClient ?? null };
}
