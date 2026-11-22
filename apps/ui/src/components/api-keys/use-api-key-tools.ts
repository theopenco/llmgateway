"use client";

import { useQueryClient } from "@tanstack/react-query";

import { revealStore } from "@/components/assistant/assistant-store";
import { useWebMcpTools } from "@/hooks/useWebMcpTools";
import { getApiErrorMessage } from "@/lib/api-error";
import { useFetchClient } from "@/lib/fetch-client";

import type { ApiKeysResponse } from "@/components/api-keys/api-keys-list";
import type { Project } from "@/lib/types";
import type { WebMcpToolDefinition } from "@/lib/webmcp";

/** What the project API Keys page lets an agent do while it is open. */
export function useApiKeyTools({
	project,
	apiKeys,
	canCreate,
}: {
	project: Project | null;
	apiKeys: ApiKeysResponse["apiKeys"] | undefined;
	canCreate: boolean;
}) {
	const queryClient = useQueryClient();
	const fetchClient = useFetchClient();

	const tools: WebMcpToolDefinition[] = [];
	if (project) {
		tools.push({
			name: "list_api_keys",
			title: "List API keys",
			description: `List the API keys of the project "${project.name}" with their status. Secrets are never included.`,
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
			execute: async () => ({
				project: project.name,
				apiKeys: (apiKeys ?? [])
					.filter((key) => key.kind !== "playground")
					.map((key) => ({
						name: key.description,
						status: key.status,
						createdAt: key.createdAt,
					})),
			}),
		});
	}
	if (project && canCreate) {
		tools.push({
			name: "create_api_key",
			title: "Create an API key",
			description: `Create a new API key in the project "${project.name}". Changes data: the user approves it in a dialog. The secret is shown to the user once and is never returned to you.`,
			inputSchema: {
				type: "object",
				properties: {
					name: {
						type: "string",
						minLength: 1,
						maxLength: 255,
						description: "Name of the key, e.g. 'Production'",
					},
				},
				required: ["name"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false, consequentialHint: true },
			execute: async (input) => {
				const name = typeof input.name === "string" ? input.name.trim() : "";
				if (!name) {
					return { error: "A key name is required" };
				}
				const { data, error } = await fetchClient.POST("/keys/api", {
					body: { description: name, projectId: project.id },
				});
				if (error) {
					throw new Error(
						getApiErrorMessage(error, "Failed to create the API key."),
					);
				}
				revealStore.set({
					title: `API key "${data.apiKey.description}"`,
					secret: data.apiKey.token,
				});
				await queryClient.invalidateQueries({ queryKey: ["get", "/keys/api"] });
				return {
					created: true,
					name: data.apiKey.description,
					note: "The secret is on screen for the user to copy; it is shown only once.",
				};
			},
		});
	}

	useWebMcpTools(tools);
}
