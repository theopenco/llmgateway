import { serve } from "@hono/node-server";
import { Hono } from "hono";

// Create a mock OpenAI API server
export const mockOpenAIServer = new Hono();

// Sample response for chat completions
const sampleChatCompletionResponse = {
	id: "chatcmpl-123",
	object: "chat.completion",
	created: Math.floor(Date.now() / 1000),
	model: "gpt-4o-mini",
	choices: [
		{
			index: 0,
			message: {
				role: "assistant",
				content:
					"Hello! I'm a mock response from the test server. How can I help you today?",
			},
			finish_reason: "stop",
		},
	],
	usage: {
		prompt_tokens: 10,
		completion_tokens: 20,
		total_tokens: 30,
	},
};

// Sample error response
const sampleErrorResponse = {
	error: {
		message:
			"The server had an error processing your request. Sorry about that!",
		type: "server_error",
		param: null,
		code: "internal_server_error",
	},
};

// Helper to extract delay from message content (e.g., "TRIGGER_TIMEOUT_500" -> 500ms)
function extractTimeoutDelay(content: string): number | null {
	const match = content.match(/TRIGGER_TIMEOUT_(\d+)/);
	if (match) {
		return parseInt(match[1], 10);
	}
	if (content.includes("TRIGGER_TIMEOUT")) {
		// Default to 5 seconds if no specific delay is provided
		return 5000;
	}
	return null;
}

// Helper to extract a specific HTTP status code from message content
// e.g., "TRIGGER_STATUS_429" -> { statusCode: 429, errorResponse: {...} }
function extractStatusCodeTrigger(
	content: string,
): { statusCode: number; errorResponse: object } | null {
	const match = content.match(/TRIGGER_STATUS_(\d{3})/);
	if (!match) {
		return null;
	}
	const statusCode = parseInt(match[1], 10);

	const errorResponses: Record<number, object> = {
		429: {
			error: {
				message: "Rate limit exceeded. Please retry after 1 second.",
				type: "rate_limit_error",
				param: null,
				code: "rate_limit_exceeded",
			},
		},
		401: {
			error: {
				message: "Incorrect API key provided.",
				type: "authentication_error",
				param: null,
				code: "invalid_api_key",
			},
		},
		403: {
			error: {
				message: "You do not have access to this resource.",
				type: "permission_error",
				param: null,
				code: "forbidden",
			},
		},
		404: {
			error: {
				message: "The model 'nonexistent-model' does not exist.",
				type: "invalid_request_error",
				param: "model",
				code: "model_not_found",
			},
		},
		400: {
			error: {
				message: "Invalid request: malformed input.",
				type: "invalid_request_error",
				param: null,
				code: "invalid_request",
			},
		},
		503: {
			error: {
				message: "The server is temporarily unavailable.",
				type: "server_error",
				param: null,
				code: "service_unavailable",
			},
		},
	};

	return {
		statusCode,
		errorResponse: errorResponses[statusCode] || {
			error: {
				message: `Mock error with status ${statusCode}`,
				type: "server_error",
				param: null,
				code: `error_${statusCode}`,
			},
		},
	};
}

// Counter for TRIGGER_FAIL_ONCE - tracks how many times a request with this
// trigger has been received. First request fails with 500, subsequent succeed.
// NOTE: This is module-level mutable state shared across all tests using this server.
// Each test that relies on TRIGGER_FAIL_ONCE must call resetFailOnceCounter()
// in its beforeEach to avoid cross-test interference.
let failOnceCounter = 0;

export function resetFailOnceCounter() {
	failOnceCounter = 0;
}

// Helper to delay response
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// Handle OpenAI Responses API endpoint (for gpt-5 and other models with supportsResponsesApi)
mockOpenAIServer.post("/v1/responses", async (c) => {
	const body = await c.req.json();

	// Check if this request should trigger an error response
	const shouldError = body.input?.some?.(
		(msg: any) =>
			msg.role === "user" && msg.content?.includes?.("TRIGGER_ERROR"),
	);

	if (shouldError) {
		c.status(500);
		return c.json(sampleErrorResponse);
	}

	// Get the user's message to include in the response
	const userMessage =
		body.input?.find?.((msg: any) => msg.role === "user")?.content ?? "";

	// Create a Responses API format response
	const response = {
		id: "resp-123",
		object: "response",
		created_at: Math.floor(Date.now() / 1000),
		model: body.model ?? "gpt-5-nano",
		output: [
			{
				type: "message",
				role: "assistant",
				content: [
					{
						type: "output_text",
						text: `Hello! I received your message: "${userMessage}". This is a mock response from the test server.`,
					},
				],
			},
		],
		usage: {
			input_tokens: 10,
			output_tokens: 20,
			total_tokens: 30,
		},
		status: "completed",
	};

	return c.json(response);
});

// Handle chat completions endpoint
mockOpenAIServer.post("/v1/chat/completions", async (c) => {
	const body = await c.req.json();

	// Check if this request should trigger an error response
	const shouldError = body.messages.some(
		(msg: any) => msg.role === "user" && msg.content.includes("TRIGGER_ERROR"),
	);

	if (shouldError) {
		c.status(500);
		return c.json(sampleErrorResponse);
	}

	// Get the user's message to include in the response
	const userMessage =
		body.messages.find((msg: any) => msg.role === "user")?.content ?? "";

	// Check if this request should trigger a specific HTTP status code error
	const statusTrigger = extractStatusCodeTrigger(userMessage);
	if (statusTrigger) {
		// Hono's c.status() expects a narrow StatusCode union type; cast needed for dynamic status codes
		c.status(statusTrigger.statusCode as any);
		return c.json(statusTrigger.errorResponse);
	}

	// Check if this request should fail on the first attempt but succeed on retry
	if (userMessage.includes("TRIGGER_FAIL_ONCE")) {
		failOnceCounter++;
		if (failOnceCounter === 1) {
			c.status(500);
			return c.json({
				error: {
					message: "Temporary server error (will succeed on retry)",
					type: "server_error",
					param: null,
					code: "internal_server_error",
				},
			});
		}
		// Subsequent requests succeed - fall through to normal response
	}

	// Check if this request should trigger a timeout (delay response)
	const timeoutDelay = extractTimeoutDelay(userMessage);
	if (timeoutDelay) {
		await delay(timeoutDelay);
	}

	// Check if this request should trigger zero tokens response
	const shouldReturnZeroTokens = body.messages.some(
		(msg: any) => msg.role === "user" && msg.content.includes("ZERO_TOKENS"),
	);

	// Create a custom response that includes the user's message
	const response = {
		...sampleChatCompletionResponse,
		choices: [
			{
				...sampleChatCompletionResponse.choices[0],
				message: {
					role: "assistant",
					content: `Hello! I received your message: "${userMessage}". This is a mock response from the test server.`,
				},
			},
		],
		usage: shouldReturnZeroTokens
			? {
					prompt_tokens: 0,
					completion_tokens: 20,
					total_tokens: 20,
				}
			: sampleChatCompletionResponse.usage,
	};

	return c.json(response);
});

// Handle Google Vertex AI generateContent endpoint (Gemini models via Vertex)
mockOpenAIServer.post(
	"/v1/projects/:project/locations/:location/publishers/google/models/:model\\:generateContent",
	async (c) => {
		const body = await c.req.json();

		const shouldError = body.contents?.some?.((content: any) =>
			content.parts?.some?.((part: any) =>
				part.text?.includes?.("TRIGGER_ERROR"),
			),
		);

		if (shouldError) {
			c.status(500);
			return c.json({
				error: {
					code: 500,
					message: "Internal server error",
					status: "INTERNAL",
				},
			});
		}

		const userMessage =
			body.contents?.find?.((ct: any) => ct.role === "user")?.parts?.[0]
				?.text ?? "";

		return c.json({
			candidates: [
				{
					content: {
						parts: [
							{
								text: `Hello! I received your message: "${userMessage}". This is a mock Google Vertex response.`,
							},
						],
						role: "model",
					},
					finishReason: "STOP",
					index: 0,
				},
			],
			usageMetadata: {
				promptTokenCount: 10,
				candidatesTokenCount: 20,
				totalTokenCount: 30,
			},
		});
	},
);

// Handle Google AI Studio generateContent endpoint (Gemini models)
mockOpenAIServer.post("/v1beta/models/:model\\:generateContent", async (c) => {
	const body = await c.req.json();

	// Check if this request should trigger an error response
	const shouldError = body.contents?.some?.((content: any) =>
		content.parts?.some?.((part: any) =>
			part.text?.includes?.("TRIGGER_ERROR"),
		),
	);

	if (shouldError) {
		c.status(500);
		return c.json({
			error: {
				code: 500,
				message: "Internal server error",
				status: "INTERNAL",
			},
		});
	}

	// Get the user's message
	const userMessage =
		body.contents?.find?.((c: any) => c.role === "user")?.parts?.[0]?.text ??
		"";

	// Return Google AI Studio format response
	return c.json({
		candidates: [
			{
				content: {
					parts: [
						{
							text: `Hello! I received your message: "${userMessage}". This is a mock Google AI response.`,
						},
					],
					role: "model",
				},
				finishReason: "STOP",
				index: 0,
			},
		],
		usageMetadata: {
			promptTokenCount: 10,
			candidatesTokenCount: 20,
			totalTokenCount: 30,
		},
	});
});

let server: any = null;

export function startMockServer(port = 3001): string {
	if (server) {
		return `http://localhost:${port}`;
	}

	server = serve({
		fetch: mockOpenAIServer.fetch,
		port,
	});

	console.log(`Mock OpenAI server started on port ${port}`);
	return `http://localhost:${port}`;
}

export function stopMockServer() {
	if (server) {
		server.close();
		server = null;
		console.log("Mock OpenAI server stopped");
	}
}
