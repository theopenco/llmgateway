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
const sample500ErrorResponse = sampleErrorResponse;

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

function extractApplicationCodeTrigger(
	content: string,
): { code: number; response: object } | null {
	const match = content.match(/TRIGGER_BODY_CODE_(\d{3})/);
	if (!match) {
		return null;
	}

	const code = parseInt(match[1], 10);

	return {
		code,
		response: {
			code,
			msg:
				code === 402
					? "Credits insufficient : Your current balance isn’t enough to run this request. Please top up to continue."
					: `Triggered application error ${code}`,
			data: null,
		},
	};
}

function extractMockVideoImage(value: unknown):
	| {
			bytesBase64Encoded: string;
			mimeType: string;
	  }
	| undefined {
	const imageUrl =
		typeof value === "string"
			? value
			: value && typeof value === "object"
				? typeof (value as Record<string, unknown>).image_url === "string"
					? ((value as Record<string, unknown>).image_url as string)
					: undefined
				: undefined;

	if (!imageUrl) {
		return undefined;
	}

	const dataUrlMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
	if (!dataUrlMatch) {
		return undefined;
	}

	return {
		mimeType: dataUrlMatch[1],
		bytesBase64Encoded: dataUrlMatch[2],
	};
}

async function extractMockVideoFileImage(file: File): Promise<{
	bytesBase64Encoded: string;
	mimeType: string;
}> {
	const bytes = await file.arrayBuffer();
	return {
		bytesBase64Encoded: Buffer.from(bytes).toString("base64"),
		mimeType: file.type || "image/png",
	};
}

// Counter for TRIGGER_FAIL_ONCE - tracks how many times a request with this
// trigger has been received. First request fails with 500, subsequent succeed.
// NOTE: This is module-level mutable state shared across all tests using this server.
// Each test that relies on TRIGGER_FAIL_ONCE must call resetFailOnceCounter()
// in its beforeEach to avoid cross-test interference.
let failOnceCounter = 0;
let currentMockServerUrl = "http://localhost:3001";
let videoCounter = 0;

interface MockVideoJobState {
	id: string;
	object: "video";
	model: string;
	status: string;
	progress: number;
	firstFrame?: {
		bytesBase64Encoded: string;
		mimeType: string;
	};
	lastFrame?: {
		bytesBase64Encoded: string;
		mimeType: string;
	};
	referenceImages?: Array<{
		bytesBase64Encoded: string;
		mimeType: string;
		referenceType: string;
	}>;
	imageUrls?: string[];
	generationType?: string;
	size?: string;
	duration?: number;
	resolution?: string;
	width?: number;
	height?: number;
	generateAudio?: boolean;
	storageUri?: string;
	created_at: number;
	completed_at: number | null;
	expires_at: number | null;
	error: { code?: string; message: string } | null;
	content?: Array<{
		type: "video";
		url: string;
		mime_type: string;
	}>;
}

interface MockWebhookDelivery {
	name: string;
	headers: Record<string, string>;
	body: unknown;
}

const videoJobs = new Map<string, MockVideoJobState>();
const webhookDeliveries: MockWebhookDelivery[] = [];
const webhookStatuses = new Map<string, number>();

function getMockVideoSizeMetadata(size: unknown): {
	size: string;
	resolution: string;
	width: number;
	height: number;
} {
	switch (size) {
		case "720x1280":
			return {
				size,
				resolution: "720p",
				width: 720,
				height: 1280,
			};
		case "1920x1080":
			return {
				size,
				resolution: "1080p",
				width: 1920,
				height: 1080,
			};
		case "1080x1920":
			return {
				size,
				resolution: "1080p",
				width: 1080,
				height: 1920,
			};
		case "3840x2160":
			return {
				size,
				resolution: "4k",
				width: 3840,
				height: 2160,
			};
		case "2160x3840":
			return {
				size,
				resolution: "4k",
				width: 2160,
				height: 3840,
			};
		case "1792x1024":
			return {
				size,
				resolution: "hd",
				width: 1792,
				height: 1024,
			};
		case "1024x1792":
			return {
				size,
				resolution: "hd",
				width: 1024,
				height: 1792,
			};
		case "1280x720":
		default:
			return {
				size: "1280x720",
				resolution: "720p",
				width: 1280,
				height: 720,
			};
	}
}

function getMockVertexVideoSizeMetadata(
	resolution: unknown,
	aspectRatio: unknown,
): {
	size: string;
	resolution: string;
	width: number;
	height: number;
} {
	if (resolution === "4k") {
		return aspectRatio === "9:16"
			? getMockVideoSizeMetadata("2160x3840")
			: getMockVideoSizeMetadata("3840x2160");
	}

	if (resolution === "1080p") {
		return aspectRatio === "9:16"
			? getMockVideoSizeMetadata("1080x1920")
			: getMockVideoSizeMetadata("1920x1080");
	}

	return aspectRatio === "9:16"
		? getMockVideoSizeMetadata("720x1280")
		: getMockVideoSizeMetadata("1280x720");
}

function getMockAvalancheSoraVideoSizeMetadata(
	aspectRatio: unknown,
	sizeTier: unknown,
): {
	size: string;
	resolution: string;
	width: number;
	height: number;
} {
	if (sizeTier === "high") {
		return aspectRatio === "portrait"
			? getMockVideoSizeMetadata("1024x1792")
			: getMockVideoSizeMetadata("1792x1024");
	}

	return aspectRatio === "portrait"
		? getMockVideoSizeMetadata("720x1280")
		: getMockVideoSizeMetadata("1280x720");
}

export function resetFailOnceCounter() {
	failOnceCounter = 0;
}

export function resetMockVideoState() {
	videoCounter = 0;
	videoJobs.clear();
	webhookDeliveries.length = 0;
	webhookStatuses.clear();
}

export function setMockVideoStatus(
	videoId: string,
	status: MockVideoJobState["status"],
	overrides: Partial<MockVideoJobState> = {},
) {
	const current = videoJobs.get(videoId);
	if (!current) {
		throw new Error(`Mock video job ${videoId} not found`);
	}

	const next: MockVideoJobState = {
		...current,
		status,
		progress: status === "completed" ? 100 : current.progress,
		completed_at:
			status === "completed"
				? Math.floor(Date.now() / 1000)
				: current.completed_at,
		error:
			status === "failed"
				? {
						message: "Mock video generation failed",
					}
				: null,
		...overrides,
	};

	if (status === "completed" && !next.content) {
		next.content = [
			{
				type: "video",
				url: `${currentMockServerUrl}/mock-assets/${videoId}`,
				mime_type: "video/mp4",
			},
		];
	}

	videoJobs.set(videoId, next);
}

export function getMockVideo(videoId: string): MockVideoJobState | undefined {
	return videoJobs.get(videoId);
}

export function setMockWebhookStatus(name: string, status: number) {
	webhookStatuses.set(name, status);
}

export function getMockWebhookDeliveries(name?: string): MockWebhookDelivery[] {
	return webhookDeliveries.filter((delivery) =>
		name ? delivery.name === name : true,
	);
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

mockOpenAIServer.post("/v1/moderations", async (c) => {
	const body = await c.req.json();
	const inputs = Array.isArray(body.input) ? body.input : [body.input];
	const combinedInput = inputs
		.map((item: any) =>
			typeof item === "string" ? item : JSON.stringify(item ?? null),
		)
		.join(" ");

	const timeoutDelay = extractTimeoutDelay(combinedInput);
	if (timeoutDelay) {
		await delay(timeoutDelay);
	}

	const statusTrigger = extractStatusCodeTrigger(combinedInput);
	if (statusTrigger) {
		c.status(statusTrigger.statusCode as any);
		return c.json(statusTrigger.errorResponse);
	}

	if (combinedInput.includes("TRIGGER_ERROR")) {
		c.status(500);
		return c.json(sampleErrorResponse);
	}

	const flagged = /harm|kill|attack/i.test(combinedInput);

	return c.json({
		id: "modr-123",
		model: body.model ?? "omni-moderation-latest",
		results: [
			{
				flagged,
				categories: {
					violence: flagged,
					self_harm: false,
				},
				category_scores: {
					violence: flagged ? 0.98 : 0.01,
					self_harm: 0.01,
				},
			},
		],
	});
});

mockOpenAIServer.post("/v1/videos", async (c) => {
	const contentType = c.req.header("content-type") ?? "";
	const authorization = c.req.header("authorization") ?? "";
	const isMultipart = contentType.includes("multipart/form-data");
	const body = isMultipart
		? await c.req.parseBody({ all: true })
		: await c.req.json();
	const prompt = typeof body.prompt === "string" ? body.prompt : "";
	const statusTrigger = extractStatusCodeTrigger(prompt);
	if (statusTrigger) {
		c.status(statusTrigger.statusCode as any);
		return c.json(statusTrigger.errorResponse);
	}
	if (prompt.includes("TRIGGER_OBSIDIAN_NO_CHANNEL")) {
		c.status(503);
		return c.json({
			error: {
				message:
					"当前分组 default 下对于模型 sora-2-pro 计费模式 [按量计费,按次计费] 无可用渠道 (request id: 2026032422002539193536177450876)",
				type: "shell_api_error",
			},
		});
	}
	videoCounter++;
	const id = `video_${videoCounter}`;
	const videoSize = getMockVideoSizeMetadata(body.size);
	const inputReferenceField = body.input_reference;
	const inputReferenceFiles = Array.isArray(inputReferenceField)
		? inputReferenceField.filter(
				(value): value is File => value instanceof File,
			)
		: inputReferenceField instanceof File
			? [inputReferenceField]
			: [];
	const firstFrame = inputReferenceFiles[0]
		? await extractMockVideoFileImage(inputReferenceFiles[0])
		: extractMockVideoImage(body.first_image ?? body.image);
	const lastFrame = inputReferenceFiles[1]
		? await extractMockVideoFileImage(inputReferenceFiles[1])
		: extractMockVideoImage(body.last_frame);
	const job: MockVideoJobState = {
		id,
		object: "video",
		model: body.model ?? "veo-3.1",
		status:
			(authorization.includes("avalanche") ||
				authorization.includes("obsidian")) &&
			typeof body.model === "string" &&
			body.model.startsWith("sora-2")
				? "submitted"
				: "queued",
		progress: 0,
		firstFrame,
		lastFrame,
		size: videoSize.size,
		duration:
			typeof body.seconds === "string"
				? Number(body.seconds)
				: typeof body.seconds === "number"
					? body.seconds
					: 8,
		resolution: videoSize.resolution,
		width: videoSize.width,
		height: videoSize.height,
		created_at: Math.floor(Date.now() / 1000),
		completed_at: null,
		expires_at: null,
		error: null,
	};

	videoJobs.set(id, job);

	return c.json(job);
});

mockOpenAIServer.post("/api/v1/veo/generate", async (c) => {
	const body = await c.req.json();
	const prompt = typeof body.prompt === "string" ? body.prompt : "";
	if (
		prompt.includes("TRIGGER_STATUS_500_AVALANCHE_ONLY") ||
		prompt.includes("TRIGGER_AVALANCHE_ONLY_500")
	) {
		c.status(500);
		return c.json(sample500ErrorResponse);
	}
	const statusTrigger = extractStatusCodeTrigger(prompt);
	if (statusTrigger) {
		c.status(statusTrigger.statusCode as any);
		return c.json(statusTrigger.errorResponse);
	}
	videoCounter++;
	const id = `avalanche_task_${videoCounter}`;
	const videoSize =
		body.aspect_ratio === "9:16"
			? {
					size: "1080x1920",
					resolution: "720p",
					width: 1080,
					height: 1920,
				}
			: {
					size: "1920x1080",
					resolution: "720p",
					width: 1920,
					height: 1080,
				};

	const job: MockVideoJobState = {
		id,
		object: "video",
		model: body.model ?? "veo3",
		status: "queued",
		progress: 0,
		imageUrls: Array.isArray(body.imageUrls)
			? body.imageUrls.filter(
					(value: unknown): value is string => typeof value === "string",
				)
			: undefined,
		generationType:
			typeof body.generationType === "string" ? body.generationType : undefined,
		size: videoSize.size,
		duration: 8,
		resolution: videoSize.resolution,
		width: videoSize.width,
		height: videoSize.height,
		created_at: Math.floor(Date.now() / 1000),
		completed_at: null,
		expires_at: null,
		error: null,
	};

	videoJobs.set(id, job);

	return c.json({
		code: 200,
		msg: "success",
		data: {
			taskId: id,
		},
	});
});

mockOpenAIServer.post("/api/v1/jobs/createTask", async (c) => {
	const body = await c.req.json();
	const prompt =
		body.input &&
		typeof body.input === "object" &&
		typeof (body.input as Record<string, unknown>).prompt === "string"
			? ((body.input as Record<string, unknown>).prompt as string)
			: "";
	const statusTrigger = extractStatusCodeTrigger(prompt);
	if (statusTrigger) {
		c.status(statusTrigger.statusCode as any);
		return c.json(statusTrigger.errorResponse);
	}
	const applicationTrigger = extractApplicationCodeTrigger(prompt);
	if (applicationTrigger) {
		return c.json(applicationTrigger.response);
	}

	videoCounter++;
	const id = `avalanche_task_${videoCounter}`;
	const input =
		body.input && typeof body.input === "object"
			? (body.input as Record<string, unknown>)
			: {};
	const videoSize = getMockAvalancheSoraVideoSizeMetadata(
		input.aspect_ratio,
		input.size,
	);
	const nFrames =
		typeof input.n_frames === "string"
			? Number(input.n_frames)
			: typeof input.n_frames === "number"
				? input.n_frames
				: 10;
	const job: MockVideoJobState = {
		id,
		object: "video",
		model: typeof body.model === "string" ? body.model : "sora-2-text-to-video",
		status: "queued",
		progress: 0,
		imageUrls: Array.isArray(input.image_urls)
			? input.image_urls.filter(
					(value: unknown): value is string => typeof value === "string",
				)
			: undefined,
		size: videoSize.size,
		duration: Number.isFinite(nFrames) ? nFrames : 10,
		resolution: videoSize.resolution,
		width: videoSize.width,
		height: videoSize.height,
		created_at: Math.floor(Date.now() / 1000),
		completed_at: null,
		expires_at: null,
		error: null,
	};

	videoJobs.set(id, job);

	return c.json({
		code: 200,
		msg: "success",
		data: {
			taskId: id,
		},
	});
});

mockOpenAIServer.post("/api/file-base64-upload", async (c) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		c.status(401);
		return c.json({
			code: 401,
			msg: "Unauthorized",
		});
	}

	const body = await c.req.json();
	const base64Data =
		typeof body.base64Data === "string" ? body.base64Data : undefined;
	if (!base64Data?.startsWith("data:image/")) {
		c.status(400);
		return c.json({
			code: 400,
			msg: "Invalid base64 data",
		});
	}

	videoCounter++;
	return c.json({
		success: true,
		code: 200,
		msg: "success",
		data: {
			fileUrl: `${currentMockServerUrl}/uploads/avalanche-image-${videoCounter}.png`,
			downloadUrl: `${currentMockServerUrl}/uploads/avalanche-image-${videoCounter}.png`,
		},
	});
});

mockOpenAIServer.post(
	"/v1/projects/:project/locations/:location/publishers/google/models/*",
	async (c, next) => {
		const vertexApiKey = c.req.query("key");
		if (
			vertexApiKey !== "vertex-test-token" &&
			vertexApiKey !== "google-test-key"
		) {
			c.status(401);
			return c.json({
				error: {
					message: "Invalid Vertex API key",
				},
			});
		}

		const body = await c.req.json();
		const modelPath = c.req.path.split("/models/")[1] ?? "";
		const [modelName, action] = modelPath.split(":");

		if (action !== "predictLongRunning" && action !== "fetchPredictOperation") {
			return await next();
		}

		if (action === "predictLongRunning") {
			const prompt =
				Array.isArray(body.instances) &&
				body.instances[0] &&
				typeof body.instances[0] === "object" &&
				typeof (body.instances[0] as Record<string, unknown>).prompt ===
					"string"
					? ((body.instances[0] as Record<string, unknown>).prompt as string)
					: "";
			if (
				prompt.includes("TRIGGER_STATUS_500_VERTEX_ONLY") ||
				prompt.includes("TRIGGER_VERTEX_ONLY_500")
			) {
				c.status(500);
				return c.json(sample500ErrorResponse);
			}
			const statusTrigger = extractStatusCodeTrigger(prompt);
			if (statusTrigger) {
				c.status(statusTrigger.statusCode as any);
				return c.json(statusTrigger.errorResponse);
			}
			videoCounter++;
			const operationName = `projects/${c.req.param("project")}/locations/${c.req.param("location")}/publishers/google/models/${modelName}/operations/video_${videoCounter}`;
			const parameters =
				body.parameters && typeof body.parameters === "object"
					? body.parameters
					: {};
			const videoSize = getMockVertexVideoSizeMetadata(
				(parameters as Record<string, unknown>).resolution,
				(parameters as Record<string, unknown>).aspectRatio,
			);
			const storageUri =
				typeof (parameters as Record<string, unknown>).storageUri === "string"
					? (parameters as Record<string, unknown>).storageUri
					: undefined;
			const instance =
				Array.isArray(body.instances) &&
				body.instances[0] &&
				typeof body.instances[0] === "object"
					? (body.instances[0] as Record<string, unknown>)
					: null;
			const firstFrame =
				instance?.image && typeof instance.image === "object"
					? (instance.image as Record<string, unknown>)
					: null;
			const lastFrame =
				instance?.lastFrame && typeof instance.lastFrame === "object"
					? (instance.lastFrame as Record<string, unknown>)
					: null;
			const referenceImages = Array.isArray(instance?.referenceImages)
				? instance.referenceImages
				: [];
			const job: MockVideoJobState = {
				id: operationName,
				object: "video",
				model: modelName || "veo-3.1-generate-preview",
				status: "queued",
				progress: 0,
				firstFrame:
					typeof firstFrame?.bytesBase64Encoded === "string" &&
					firstFrame.bytesBase64Encoded.length > 0
						? {
								bytesBase64Encoded: firstFrame.bytesBase64Encoded,
								mimeType:
									typeof firstFrame.mimeType === "string" &&
									firstFrame.mimeType.length > 0
										? firstFrame.mimeType
										: "image/png",
							}
						: undefined,
				lastFrame:
					typeof lastFrame?.bytesBase64Encoded === "string" &&
					lastFrame.bytesBase64Encoded.length > 0
						? {
								bytesBase64Encoded: lastFrame.bytesBase64Encoded,
								mimeType:
									typeof lastFrame.mimeType === "string" &&
									lastFrame.mimeType.length > 0
										? lastFrame.mimeType
										: "image/png",
							}
						: undefined,
				referenceImages: referenceImages
					.map((referenceImage) => {
						if (
							!referenceImage ||
							typeof referenceImage !== "object" ||
							!("image" in referenceImage)
						) {
							return null;
						}

						const image =
							(referenceImage as Record<string, unknown>).image &&
							typeof (referenceImage as Record<string, unknown>).image ===
								"object"
								? ((referenceImage as Record<string, unknown>).image as Record<
										string,
										unknown
									>)
								: null;
						if (
							typeof image?.bytesBase64Encoded !== "string" ||
							image.bytesBase64Encoded.length === 0
						) {
							return null;
						}

						const referenceType =
							typeof (referenceImage as Record<string, unknown>)
								.referenceType === "string"
								? ((referenceImage as Record<string, unknown>)
										.referenceType as string)
								: "asset";

						return {
							bytesBase64Encoded: image.bytesBase64Encoded,
							mimeType:
								typeof image.mimeType === "string" && image.mimeType.length > 0
									? image.mimeType
									: "image/png",
							referenceType: referenceType.length > 0 ? referenceType : "asset",
						};
					})
					.filter(
						(
							referenceImage,
						): referenceImage is NonNullable<typeof referenceImage> =>
							referenceImage !== null,
					),
				size: videoSize.size,
				duration:
					typeof (parameters as Record<string, unknown>).durationSeconds ===
						"number" &&
					Number.isFinite(
						(parameters as Record<string, unknown>).durationSeconds,
					)
						? ((parameters as Record<string, unknown>)
								.durationSeconds as number)
						: 8,
				generateAudio:
					typeof (parameters as Record<string, unknown>).generateAudio ===
					"boolean"
						? ((parameters as Record<string, unknown>).generateAudio as boolean)
						: true,
				resolution: videoSize.resolution,
				width: videoSize.width,
				height: videoSize.height,
				storageUri:
					typeof storageUri === "string"
						? `${storageUri.replace(/\/$/, "")}/output.mp4`
						: undefined,
				created_at: Math.floor(Date.now() / 1000),
				completed_at: null,
				expires_at: null,
				error: null,
			};

			videoJobs.set(operationName, job);

			return c.json({
				name: operationName,
				done: false,
			});
		}

		if (action === "fetchPredictOperation") {
			const operationName =
				body && typeof body === "object" ? body.operationName : undefined;

			if (typeof operationName !== "string" || operationName.length === 0) {
				c.status(400);
				return c.json({
					error: {
						message: "operationName is required",
					},
				});
			}

			const job = videoJobs.get(operationName);
			if (!job) {
				c.status(404);
				return c.json({
					error: {
						message: "Operation not found",
					},
				});
			}

			if (job.status === "failed") {
				return c.json({
					name: operationName,
					done: true,
					error: {
						code: 13,
						message: "Mock Vertex generation failed",
					},
				});
			}

			if (job.status !== "completed") {
				return c.json({
					name: operationName,
					done: false,
				});
			}

			return c.json({
				name: operationName,
				done: true,
				response: {
					videos: [
						job.storageUri
							? {
									gcsUri: job.storageUri,
									mimeType: "video/mp4",
								}
							: {
									bytesBase64Encoded: Buffer.from(
										`mock-video-${operationName}`,
									).toString("base64"),
									mimeType: "video/mp4",
								},
					],
				},
			});
		}

		c.status(404);
		return c.json({
			error: {
				message: "Unsupported Google Vertex mock action",
			},
		});
	},
);

mockOpenAIServer.get("/v1/videos/:id", async (c) => {
	const id = c.req.param("id");
	const job = videoJobs.get(id);

	if (!job) {
		c.status(404);
		return c.json({
			error: {
				message: "Video job not found",
				code: "not_found",
			},
		});
	}

	return c.json(job);
});

mockOpenAIServer.get("/v1/videos/:id/content", async (c) => {
	const id = c.req.param("id");
	const job = videoJobs.get(id);

	if (!job) {
		c.status(404);
		return c.json({
			error: {
				message: "Video job not found",
				code: "not_found",
			},
		});
	}

	return c.json({
		url: `${currentMockServerUrl}/mock-assets/${id}`,
		mime_type: "video/mp4",
		size: job.size,
		duration: job.duration,
		resolution: job.resolution,
		width: job.width,
		height: job.height,
	});
});

mockOpenAIServer.get("/mock-gcs/:bucket/*", async (c) => {
	const bucket = c.req.param("bucket");
	const objectPath = c.req.path.replace(`/mock-gcs/${bucket}/`, "");
	const job = [...videoJobs.values()].find(
		(videoJob) =>
			typeof videoJob.storageUri === "string" &&
			videoJob.storageUri === `gs://${bucket}/${objectPath}`,
	);

	return new Response(`mock-video-${job?.id ?? objectPath}`, {
		status: 200,
		headers: {
			"Content-Type": "video/mp4",
		},
	});
});

mockOpenAIServer.get("/api/v1/veo/record-info", async (c) => {
	const taskId = c.req.query("taskId");
	if (!taskId) {
		c.status(400);
		return c.json({
			code: 400,
			msg: "taskId is required",
		});
	}

	const job = videoJobs.get(taskId);
	if (!job) {
		c.status(404);
		return c.json({
			code: 404,
			msg: "task not found",
		});
	}

	const successFlag =
		job.status === "completed" ? 1 : job.status === "failed" ? -1 : 0;

	return c.json({
		code: 200,
		msg: "success",
		data: {
			taskId,
			successFlag,
			createTime: job.created_at,
			completeTime: job.completed_at,
			response: {
				resultUrls:
					job.status === "completed"
						? [`${currentMockServerUrl}/mock-assets/${taskId}`]
						: [],
				resolution: job.resolution ?? "720p",
			},
		},
	});
});

mockOpenAIServer.get("/api/v1/jobs/recordInfo", async (c) => {
	const taskId = c.req.query("taskId");
	if (!taskId) {
		c.status(400);
		return c.json({
			code: 400,
			msg: "taskId is required",
		});
	}

	const job = videoJobs.get(taskId);
	if (!job) {
		c.status(404);
		return c.json({
			code: 404,
			msg: "task not found",
		});
	}

	const state =
		job.status === "completed"
			? "success"
			: job.status === "failed"
				? "fail"
				: job.status === "in_progress"
					? "generating"
					: "waiting";

	return c.json({
		code: 200,
		msg: "success",
		data: {
			taskId,
			model: job.model,
			state,
			progress:
				job.status === "completed"
					? 100
					: job.status === "in_progress"
						? 50
						: 0,
			resultJson:
				job.status === "completed"
					? JSON.stringify({
							resultUrls: [`${currentMockServerUrl}/mock-assets/${taskId}`],
						})
					: "",
			failCode: job.status === "failed" ? "501" : "",
			failMsg: job.status === "failed" ? "Mock video generation failed" : "",
			completeTime: job.completed_at ? job.completed_at * 1000 : null,
			createTime: job.created_at * 1000,
			updateTime: (job.completed_at ?? job.created_at) * 1000,
		},
	});
});

mockOpenAIServer.get("/api/v1/veo/get-1080p-video", async (c) => {
	const taskId = c.req.query("taskId");
	if (!taskId) {
		c.status(400);
		return c.json({
			code: 400,
			msg: "taskId is required",
		});
	}

	const job = videoJobs.get(taskId);
	if (!job) {
		c.status(404);
		return c.json({
			code: 404,
			msg: "task not found",
		});
	}

	if (job.status !== "completed") {
		c.status(422);
		return c.json({
			code: 422,
			msg: "video is still processing",
		});
	}

	return c.json({
		code: 200,
		msg: "success",
		data: {
			taskId,
			resultUrl: `${currentMockServerUrl}/mock-assets/${taskId}-1080p`,
		},
	});
});

mockOpenAIServer.post("/api/v1/veo/get-4k-video", async (c) => {
	const body = await c.req.json();
	const taskId = body.taskId;

	if (typeof taskId !== "string" || taskId.length === 0) {
		c.status(400);
		return c.json({
			code: 400,
			msg: "taskId is required",
		});
	}

	const job = videoJobs.get(taskId);
	if (!job) {
		c.status(404);
		return c.json({
			code: 404,
			msg: "task not found",
		});
	}

	if (job.status !== "completed") {
		c.status(422);
		return c.json({
			code: 422,
			msg: "video is still processing",
		});
	}

	return c.json({
		code: 200,
		msg: "success",
		data: {
			taskId: `${taskId}_4k`,
			resultUrls: [`${currentMockServerUrl}/mock-assets/${taskId}-4k`],
		},
	});
});

mockOpenAIServer.get("/mock-assets/:id", async (c) => {
	const id = c.req.param("id");
	return c.body(`mock-video-${id}`, 200, {
		"Content-Type": "video/mp4",
	});
});

mockOpenAIServer.post("/mock-callback/:name", async (c) => {
	const name = c.req.param("name");
	const headers = Object.fromEntries(c.req.raw.headers.entries());
	const body = await c.req.json();

	webhookDeliveries.push({
		name,
		headers,
		body,
	});

	const status = webhookStatuses.get(name) ?? 200;
	c.status(status as any);
	return c.json({
		ok: status >= 200 && status < 300,
	});
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

mockOpenAIServer.post("/model/:model/converse", async (c) => {
	const body = await c.req.json();
	const userMessage = body.messages?.[0]?.content?.[0]?.text ?? "";

	if (userMessage.includes("TRIGGER_BEDROCK_HEADER_ERROR")) {
		c.header(
			"x-amzn-errormessage",
			"The provided model identifier is invalid for this account.",
		);
		c.header("x-amzn-errortype", "ValidationException");
		c.status(400);
		return c.json({});
	}

	return c.json({
		output: {
			message: {
				role: "assistant",
				content: [{ text: `Bedrock mock response: ${userMessage}` }],
			},
		},
		stopReason: "end_turn",
		usage: {
			inputTokens: 10,
			outputTokens: 20,
			totalTokens: 30,
		},
	});
});

mockOpenAIServer.post("/model/:model/converse-stream", async (c) => {
	const body = await c.req.json();
	const userMessage = body.messages?.[0]?.content?.[0]?.text ?? "";

	if (userMessage.includes("TRIGGER_BEDROCK_HEADER_ERROR")) {
		c.header(
			"x-amzn-errormessage",
			"The provided model identifier is invalid for this account.",
		);
		c.header("x-amzn-errortype", "ValidationException");
		c.status(400);
		return c.json({});
	}

	c.header("content-type", "application/vnd.amazon.eventstream");
	return c.body("");
});

let server: any = null;

export function startMockServer(port = 3001): string {
	if (server) {
		return `http://localhost:${port}`;
	}

	currentMockServerUrl = `http://localhost:${port}`;

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
