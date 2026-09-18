import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	APICallError,
	convertToModelMessages,
	dynamicTool,
	isToolUIPart,
	jsonSchema,
	JsonToSseTransformStream,
	safeValidateUIMessages,
	streamText,
} from "ai";
import { HTTPException } from "hono/http-exception";

import { listConnectorTools } from "@/lib/connectors/tools.js";
import { resolvePlaygroundToken } from "@/utils/playground-key.js";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { logger } from "@llmgateway/logger";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { loungeConnectorIds } from "@llmgateway/shared/lounge-connectors";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";
import {
	extractUrlCitations,
	inspectGatewayStream,
	withSseKeepalive,
} from "@llmgateway/shared/lounge-stream";
import { getLoungeToolApprovalSecret } from "@llmgateway/shared/lounge-tool-approval";

import type { ServerTypes } from "@/vars.js";
import type { GatewaySourceCitation } from "@llmgateway/shared/lounge-stream";
import type { ToolSet, UIMessageChunk } from "ai";

export const loungeChat = new OpenAPIHono<ServerTypes>();

const errorResponse = {
	description: "Chat request failed",
	content: {
		"application/json": { schema: z.object({ message: z.string() }) },
	},
};

loungeChat.openapi(
	createRoute({
		method: "post",
		path: "/chat",
		tags: ["Lounge"],
		request: {
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z
							.object({
								model: z.string().min(1).max(255),
								messages: z
									.array(
										z.object({
											id: z.string().min(1).max(255),
											role: z.enum(["user", "assistant", "system"]),
											parts: z.array(z.record(z.unknown())).min(1),
										}),
									)
									.min(1),
								connectors: z
									.array(z.enum(loungeConnectorIds))
									.max(loungeConnectorIds.length)
									.default([]),
								temperature: z.number().min(0).max(2).optional(),
								maxTokens: z.number().int().positive().optional(),
								reasoningEffort: z
									.enum([
										"none",
										"minimal",
										"low",
										"medium",
										"high",
										"xhigh",
										"max",
									])
									.optional(),
								webSearch: z.boolean().optional(),
							})
							.strict(),
					},
				},
			},
		},
		responses: {
			200: {
				description:
					"UI message events; tool calls require explicit approval and separate execution",
				content: { "text/event-stream": { schema: z.string() } },
			},
			400: errorResponse,
			401: errorResponse,
			409: errorResponse,
			502: errorResponse,
			503: errorResponse,
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const validated = await safeValidateUIMessages({ messages: body.messages });
		if (!validated.success) {
			throw new HTTPException(400, {
				message: "The conversation contains invalid message parts",
			});
		}
		const messages = validated.data;
		if (
			messages.some((message) =>
				message.parts.some(
					(part) =>
						isToolUIPart(part) &&
						!["output-available", "output-error", "output-denied"].includes(
							part.state,
						),
				),
			)
		) {
			throw new HTTPException(400, {
				message:
					"Resolve pending tool calls before continuing the conversation",
			});
		}
		const tools: ToolSet = {};
		for (const definition of await listConnectorTools(user.id, [
			...new Set(body.connectors),
		])) {
			// Clients execute only after approval; this route never runs connector tools.
			tools[
				`${definition.connectorId.replaceAll("-", "_")}__${definition.name}`
			] = dynamicTool({
				description: `${definition.connectorId}: ${definition.description}`,
				inputSchema: jsonSchema<Record<string, unknown>>(
					definition.inputSchema,
				),
			});
		}
		const token =
			c.req.header("x-llmgateway-key") ??
			(await resolvePlaygroundToken(c, user));
		const citations = new Map<string, GatewaySourceCitation>();
		const llmgateway = createLLMGateway({
			apiKey: token,
			baseURL: getGatewayApiBaseUrl(),
			headers: {
				"x-source": LOUNGE_SOURCE,
				...(body.model.includes("/") && { "x-no-fallback": "true" }),
			},
			extraBody: {
				reasoning_effort: body.reasoningEffort,
				web_search: body.webSearch,
			},
			fetch: async (input, init) => {
				const response = await fetch(input, init);
				if (
					!response.body ||
					!response.headers.get("content-type")?.includes("text/event-stream")
				) {
					return response;
				}
				return new Response(
					response.body.pipeThrough(
						inspectGatewayStream((event) => {
							for (const citation of extractUrlCitations(event)) {
								citations.set(citation.url, citation);
							}
						}),
					),
					{
						status: response.status,
						statusText: response.statusText,
						headers: response.headers,
					},
				);
			},
		});
		const result = streamText({
			model: llmgateway.chat(body.model, { usage: { include: true } }),
			messages: await convertToModelMessages(messages),
			tools,
			toolApproval: () => "user-approval",
			experimental_toolApprovalSecret: getLoungeToolApprovalSecret(user.id),
			// The gateway owns remote attachment fetching and URL validation.
			experimental_download: async (urls) => urls.map(() => null),
			temperature: body.temperature,
			maxOutputTokens: body.maxTokens,
			maxRetries: 0,
			onError: ({ error }) => {
				logger.error("Lounge chat stream failed", {
					errorName: error instanceof Error ? error.name : "UnknownError",
					upstreamStatus: APICallError.isInstance(error)
						? error.statusCode
						: undefined,
				});
			},
			abortSignal: AbortSignal.any([
				c.req.raw.signal,
				AbortSignal.timeout(300_000),
			]),
		});
		const emitted = new Set<string>();
		const stream = result
			.toUIMessageStream({
				originalMessages: messages,
				sendReasoning: true,
				sendSources: true,
				onError: (error) => {
					return APICallError.isInstance(error) && error.statusCode === 402
						? "Your Lounge allowance is used up. Manage your membership on the website."
						: "The model could not complete this response. Please try again.";
				},
			})
			.pipeThrough(
				new TransformStream<UIMessageChunk, UIMessageChunk>({
					transform(chunk, controller) {
						if (chunk.type === "finish-step") {
							for (const citation of citations.values()) {
								if (emitted.has(citation.url)) {
									continue;
								}
								controller.enqueue({
									type: "source-url",
									sourceId: `gateway-citation-${emitted.size}`,
									...citation,
								});
								emitted.add(citation.url);
							}
						}
						controller.enqueue(chunk);
					},
				}),
			)
			.pipeThrough(new JsonToSseTransformStream());
		return new Response(withSseKeepalive(stream, 15_000), {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache, no-transform",
				"x-vercel-ai-ui-message-stream": "v1",
				"x-accel-buffering": "no",
			},
		});
	},
);
