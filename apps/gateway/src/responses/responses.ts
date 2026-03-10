import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { app } from "@/app.js";
import {
	findApiKeyByToken,
	findProjectById,
	findOrganizationById,
} from "@/lib/cached-queries.js";

import { logger } from "@llmgateway/logger";

import { responsesRequestSchema } from "./schemas.js";
import { convertChatResponseToResponses } from "./tools/convert-chat-to-responses.js";
import { convertResponsesInputToMessages } from "./tools/convert-responses-to-chat.js";
import {
	createStreamingState,
	createResponseCreatedEvent,
	processStreamChunk,
	createCompletionEvents,
	createFailedEvent,
} from "./tools/convert-streaming-to-responses.js";
import { storeResponse, getStoredResponse } from "./tools/response-state.js";

import type { ServerTypes } from "@/vars.js";

export const responses = new Hono<ServerTypes>();

/**
 * Extract and validate the API token from request headers.
 * Returns the token, apiKey, project, and organization.
 */
async function authenticateRequest(c: {
	req: { header: (name: string) => string | undefined };
}) {
	const auth = c.req.header("Authorization");
	const xApiKey = c.req.header("x-api-key");

	let token: string | undefined;

	if (auth) {
		const split = auth.split("Bearer ");
		if (split.length === 2 && split[1]) {
			token = split[1];
		}
	}

	if (!token && xApiKey) {
		token = xApiKey;
	}

	if (!token) {
		return { error: "No API key provided", status: 401 as const };
	}

	const apiKey = await findApiKeyByToken(token);
	if (!apiKey || apiKey.status !== "active") {
		return { error: "Invalid API key", status: 401 as const };
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		return { error: "Could not find project", status: 500 as const };
	}

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		return { error: "Could not find organization", status: 500 as const };
	}

	return { apiKey, project, organization };
}

/**
 * POST /v1/responses - OpenAI Responses API endpoint
 *
 * Converts Responses API requests to chat completions format,
 * proxies through the existing chat completions handler,
 * then converts the response back to Responses API format.
 */
responses.post("/", async (c) => {
	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return c.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
					code: "invalid_json",
				},
			},
			400,
		);
	}

	const validation = responsesRequestSchema.safeParse(rawBody);
	if (!validation.success) {
		return c.json(
			{
				error: {
					message: `Invalid request: ${validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
					type: "invalid_request_error",
					code: "invalid_request",
				},
			},
			400,
		);
	}

	const req = validation.data;

	// Authenticate and check data retention
	const authResult = await authenticateRequest(c);
	if ("error" in authResult) {
		return c.json(
			{
				error: {
					message: authResult.error,
					type: "invalid_request_error",
					code: "unauthorized",
				},
			},
			authResult.status,
		);
	}

	const { project, organization } = authResult;

	if (organization.retentionLevel !== "retain") {
		return c.json(
			{
				error: {
					message:
						"The Responses API requires data retention to be enabled. Enable 'Retain All Data' in your organization's policies, or use /v1/chat/completions instead.",
					type: "invalid_request_error",
					code: "data_retention_required",
				},
			},
			400,
		);
	}

	const projectId = project.id;

	let inputItems: unknown[];
	if (typeof req.input === "string") {
		inputItems = [{ role: "user", content: req.input }];
	} else {
		inputItems = req.input;
	}

	// Handle previous_response_id for conversation chaining
	if (req.previous_response_id) {
		const stored = await getStoredResponse(req.previous_response_id, projectId);
		if (!stored) {
			return c.json(
				{
					error: {
						message: `Previous response '${req.previous_response_id}' not found`,
						type: "invalid_request_error",
						code: "response_not_found",
					},
				},
				404,
			);
		}

		// Reconstruct conversation: stored input + stored output + new input
		inputItems = [
			...(stored.input as unknown[]),
			...(stored.output as unknown[]),
			...inputItems,
		];

		// Use stored instructions if not overridden
		if (!req.instructions && stored.instructions) {
			req.instructions = stored.instructions;
		}
	}

	// Convert Responses API input to chat completions messages
	const messages = convertResponsesInputToMessages(
		inputItems as typeof req.input,
		req.instructions,
	);

	// Convert tools format: Responses API has name/description/parameters at top level,
	// chat completions nests under function
	const tools = req.tools?.map((tool) => {
		if (tool.type === "function") {
			return {
				type: "function" as const,
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				},
			};
		}
		// web_search passes through as-is
		return tool;
	});

	// Convert text.format to response_format
	let response_format: Record<string, unknown> | undefined;
	if (req.text?.format) {
		if (req.text.format.type === "json_schema") {
			response_format = {
				type: "json_schema",
				json_schema: {
					name: req.text.format.name,
					schema: req.text.format.schema,
					strict: req.text.format.strict,
				},
			};
		} else {
			response_format = req.text.format;
		}
	}

	// Build chat completions request
	const chatRequest: Record<string, unknown> = {
		model: req.model,
		messages,
		stream: req.stream,
	};

	if (req.temperature !== undefined) {
		chatRequest.temperature = req.temperature;
	}
	if (req.max_output_tokens !== undefined) {
		chatRequest.max_tokens = req.max_output_tokens;
	}
	if (req.top_p !== undefined) {
		chatRequest.top_p = req.top_p;
	}
	if (tools) {
		chatRequest.tools = tools;
	}
	if (req.tool_choice) {
		chatRequest.tool_choice = req.tool_choice;
	}
	if (req.reasoning?.effort) {
		chatRequest.reasoning_effort = req.reasoning.effort;
	}
	if (response_format) {
		chatRequest.response_format = response_format;
	}

	// Enable stream_options for usage in streaming mode
	if (req.stream) {
		chatRequest.stream_options = { include_usage: true };
	}

	// Generate the response ID upfront so we can pass it to the log entry
	const state = createStreamingState(req.model);
	const responsesApiId = state.responseId;

	// Build Responses API data for storage in the log entry.
	// For streaming, we'll update this after completion with the final output.
	const responsesApiData = {
		input: inputItems,
		output: [] as unknown[],
		instructions: req.instructions,
		model: req.model,
	};

	// Make internal request to the existing chat completions endpoint
	const response = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: c.req.header("Authorization") ?? "",
			"x-api-key": c.req.header("x-api-key") ?? "",
			"User-Agent": c.req.header("User-Agent") ?? "",
			"x-request-id": c.req.header("x-request-id") ?? "",
			"x-source": c.req.header("x-source") ?? "",
			"x-debug": c.req.header("x-debug") ?? "",
			"HTTP-Referer": c.req.header("HTTP-Referer") ?? "",
			"x-responses-api-id": responsesApiId,
			"x-responses-api-data": JSON.stringify(responsesApiData),
		},
		body: JSON.stringify(chatRequest),
	});

	if (!response.ok) {
		logger.warn("Responses API -> chat completions request failed", {
			status: response.status,
			statusText: response.statusText,
		});
		const errorData = await response.text();
		try {
			const errorJson = JSON.parse(errorData);
			return c.json(
				errorJson,
				response.status as 400 | 401 | 402 | 403 | 404 | 429 | 500,
			);
		} catch {
			return c.json(
				{
					error: {
						message: `Request failed: ${errorData}`,
						type: "api_error",
						code: "internal_error",
					},
				},
				response.status as 400 | 401 | 402 | 403 | 404 | 429 | 500,
			);
		}
	}

	// Handle streaming response
	if (req.stream) {
		if (!response.body) {
			return c.json(
				{
					error: {
						message: "No response body from upstream",
						type: "api_error",
						code: "internal_error",
					},
				},
				500,
			);
		}

		const streamBody = response.body;
		const shouldStore = req.store !== false;

		return streamSSE(c, async (stream) => {
			const reader = streamBody.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			// Send response.created
			const createdEvent = createResponseCreatedEvent(state);
			await stream.writeSSE({
				event: createdEvent.event,
				data: createdEvent.data,
			});

			const processLine = async (line: string) => {
				if (!line.startsWith("data: ")) {
					return false;
				}
				const data = line.slice(6).trim();

				if (data === "[DONE]") {
					// Send completion events
					const completionEvents = createCompletionEvents(state);
					for (const event of completionEvents) {
						await stream.writeSSE({
							event: event.event,
							data: event.data,
						});
					}

					// Store for previous_response_id
					if (shouldStore) {
						const completedData = JSON.parse(
							completionEvents[completionEvents.length - 1]!.data,
						);
						await storeResponse(
							responsesApiId,
							{
								id: responsesApiId,
								input: inputItems,
								output: completedData.response?.output ?? [],
								instructions: req.instructions,
								model: req.model,
							},
							projectId,
						);
					}
					return true;
				}

				if (!data) {
					return false;
				}

				let chunk: Record<string, unknown>;
				try {
					chunk = JSON.parse(data);
				} catch {
					return false;
				}

				const events = processStreamChunk(chunk, state);
				for (const event of events) {
					await stream.writeSSE({
						event: event.event,
						data: event.data,
					});
				}
				return false;
			};

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						const isDone = await processLine(line);
						if (isDone) {
							return;
						}
					}
				}

				// Process any remaining data in the buffer
				if (buffer.trim()) {
					await processLine(buffer);
				}
			} catch (error) {
				logger.error("Error processing streaming response", {
					error,
				});
				const failedEvent = createFailedEvent(state);
				await stream.writeSSE({
					event: failedEvent.event,
					data: failedEvent.data,
				});
			}
		});
	}

	// Handle non-streaming response
	const chatJson = await response.json();
	const responsesResponse = convertChatResponseToResponses(
		chatJson,
		req.model,
		responsesApiId,
	);

	// Store for previous_response_id (unless store: false)
	if (req.store !== false) {
		await storeResponse(
			responsesResponse.id,
			{
				id: responsesResponse.id,
				input: inputItems,
				output: responsesResponse.output,
				instructions: req.instructions,
				model: req.model,
			},
			projectId,
		);
	}

	return c.json(responsesResponse);
});

/**
 * GET /v1/responses/:response_id - Retrieve a stored response
 */
responses.get("/:response_id", async (c) => {
	// Authenticate for project scoping
	const authResult = await authenticateRequest(c);
	if ("error" in authResult) {
		return c.json(
			{
				error: {
					message: authResult.error,
					type: "invalid_request_error",
					code: "unauthorized",
				},
			},
			authResult.status,
		);
	}

	const { project } = authResult;
	const responseId = c.req.param("response_id");
	const stored = await getStoredResponse(responseId, project.id);

	if (!stored) {
		return c.json(
			{
				error: {
					message: `Response '${responseId}' not found`,
					type: "invalid_request_error",
					code: "response_not_found",
				},
			},
			404,
		);
	}

	return c.json({
		id: stored.id,
		object: "response",
		model: stored.model,
		output: stored.output,
		status: "completed",
	});
});
