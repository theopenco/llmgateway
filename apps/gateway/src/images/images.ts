import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { app } from "@/app.js";

import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

const imageGenerationsRequestSchema = z.object({
	prompt: z.string().min(1).openapi({
		description: "A text description of the desired image(s).",
		example: "A white siamese cat",
	}),
	model: z.string().optional().default("auto").openapi({
		description:
			"The model to use for image generation. Defaults to auto which selects an appropriate image generation model.",
		example: "gemini-2.5-flash-image",
	}),
	n: z.number().int().min(1).max(10).optional().default(1).openapi({
		description: "The number of images to generate. Must be between 1 and 10.",
		example: 1,
	}),
	size: z.string().optional().openapi({
		description:
			"The size of the generated images. Supported sizes depend on the model and provider.",
		example: "1024x1024",
	}),
	quality: z
		.enum(["standard", "hd", "low", "medium", "high"])
		.optional()
		.openapi({
			description:
				"The quality of the image that will be generated. Supported values depend on the model and provider.",
			example: "standard",
		}),
	response_format: z
		.literal("b64_json")
		.optional()
		.default("b64_json")
		.openapi({
			description:
				"The format in which the generated images are returned. Only b64_json is supported since images are generated via chat completions models.",
			example: "b64_json",
		}),
	style: z.enum(["vivid", "natural"]).optional().openapi({
		description: "The style of the generated images.",
		example: "vivid",
	}),
	aspect_ratio: z.string().optional().openapi({
		description:
			"The aspect ratio of the generated images (e.g. '1:1', '16:9', '4:3', '5:4'). Takes precedence over size if both are provided.",
		example: "16:9",
	}),
});

type ImageGenerationsRequest = z.infer<typeof imageGenerationsRequestSchema>;

const imageGenerationsResponseSchema = z.object({
	created: z.number(),
	data: z.array(
		z.object({
			b64_json: z.string(),
			revised_prompt: z.string().optional(),
		}),
	),
});

const generations = createRoute({
	operationId: "v1_images_generations",
	summary: "Create image",
	description:
		"Creates an image given a prompt. Internally routes to a chat completions model with image generation capabilities.",
	method: "post",
	path: "/generations",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: imageGenerationsRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: imageGenerationsResponseSchema,
				},
			},
			description: "Image generation response.",
		},
	},
});

/**
 * Parse a size string like "1024x1024" into an aspect ratio string.
 */
function sizeToAspectRatio(size: string): string | undefined {
	const match = size.match(/^(\d+)x(\d+)$/);
	if (!match) {
		return undefined;
	}
	const w = Number(match[1]);
	const h = Number(match[2]);
	if (w === h) {
		return "1:1";
	}
	// Simplify common ratios
	if (w === 1792 && h === 1024) {
		return "7:4";
	}
	if (w === 1024 && h === 1792) {
		return "4:7";
	}
	if (w === 1536 && h === 1024) {
		return "3:2";
	}
	if (w === 1024 && h === 1536) {
		return "2:3";
	}
	// Fallback: return w:h
	return `${w}:${h}`;
}

/**
 * Build the prompt text for the chat completions model.
 * Incorporates quality and style hints so the model knows what to generate.
 */
function buildImagePrompt(request: ImageGenerationsRequest): string {
	let prompt = `Generate an image based on the following description: ${request.prompt}`;

	if (request.style === "vivid") {
		prompt += "\n\nStyle: vivid, hyper-real, dramatic lighting and colors.";
	} else if (request.style === "natural") {
		prompt += "\n\nStyle: natural, realistic, organic look.";
	}

	if (request.quality === "hd" || request.quality === "high") {
		prompt += "\n\nQuality: high quality, detailed.";
	}

	if (request.n && request.n > 1) {
		prompt += `\n\nGenerate ${request.n} different variations of this image.`;
	}

	return prompt;
}

export const images = new OpenAPIHono<ServerTypes>();

images.openapi(generations, async (c) => {
	// Manual request parsing with better error handling
	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		throw new HTTPException(400, {
			message: "Invalid JSON in request body",
		});
	}

	// Validate against schema
	const validationResult = imageGenerationsRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		throw new HTTPException(400, {
			message: `Invalid request parameters: ${validationResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`,
		});
	}

	const request = validationResult.data;

	// Resolve "auto" model to a default image generation model
	const model =
		request.model === "auto" ? "gemini-3-pro-image-preview" : request.model;

	// Build the chat completions request
	const chatPrompt = buildImagePrompt(request);
	const aspectRatio =
		request.aspect_ratio ??
		(request.size ? sizeToAspectRatio(request.size) : undefined);

	const chatRequest: Record<string, unknown> = {
		model,
		messages: [
			{
				role: "user",
				content: chatPrompt,
			},
		],
		// Do not stream - we need the full response to extract images
		stream: false,
	};

	// Pass image configuration if we have an aspect ratio or size
	if (aspectRatio || request.size) {
		chatRequest.image_config = {
			...(aspectRatio && { aspect_ratio: aspectRatio }),
			...(request.size && { image_size: request.size }),
			n: request.n,
		};
	}

	logger.debug("Images API - forwarding to chat completions", {
		model: request.model,
		prompt: request.prompt.slice(0, 200),
		size: request.size,
		n: request.n,
	});

	// Forward auth and tracing headers
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
		},
		body: JSON.stringify(chatRequest),
	});

	if (!response.ok) {
		logger.warn("Images API - chat completions request failed", {
			status: response.status,
			statusText: response.statusText,
		});
		const errorData = await response.text();
		let errorMessage = `Image generation failed with status ${response.status}`;
		try {
			const parsed = JSON.parse(errorData);
			errorMessage = parsed?.error?.message ?? parsed?.message ?? errorMessage;
		} catch {
			// use default message
		}

		throw new HTTPException(response.status as any, {
			message: errorMessage,
		});
	}

	// Parse the chat completions response
	let chatResponse: any;
	try {
		const responseText = await response.text();
		chatResponse = JSON.parse(responseText);
	} catch (error) {
		logger.error("Images API - failed to parse chat completions response", {
			err: error instanceof Error ? error : new Error(String(error)),
		});
		throw new HTTPException(500, {
			message: "Failed to parse image generation response",
		});
	}

	// Extract images from the chat completions response
	// Images can be in:
	// 1. choices[0].message.images[] - as ImageObject with image_url.url containing data:mime;base64,data
	// 2. choices[0].message.content - may contain base64 image data in some cases
	const imageObjects: Array<{
		b64_json: string;
		revised_prompt?: string;
	}> = [];

	const messageImages = chatResponse.choices?.[0]?.message?.images;
	if (
		messageImages &&
		Array.isArray(messageImages) &&
		messageImages.length > 0
	) {
		for (const img of messageImages) {
			const dataUrl = img.image_url?.url;
			if (dataUrl && typeof dataUrl === "string") {
				// Extract base64 data from data URL: "data:image/png;base64,<data>"
				const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
				if (base64Match && base64Match[1]) {
					imageObjects.push({
						b64_json: base64Match[1],
						revised_prompt: request.prompt,
					});
				}
			}
		}
	}

	// If no images were extracted from the images field, check if content has data URLs
	if (imageObjects.length === 0) {
		const content = chatResponse.choices?.[0]?.message?.content;
		if (content && typeof content === "string") {
			// Split on the data URL prefix and extract base64 data without regex on large strings
			const parts = content.split("data:image/");
			for (let i = 1; i < parts.length; i++) {
				const part = parts[i];
				const base64Marker = ";base64,";
				const markerIndex = part.indexOf(base64Marker);
				if (markerIndex === -1) {
					continue;
				}

				const base64Start = markerIndex + base64Marker.length;
				// Find the end of base64 data: first character not in the base64 alphabet
				let end = base64Start;
				while (end < part.length) {
					const ch = part.charCodeAt(end);
					// A-Z, a-z, 0-9, +, /, =
					if (
						(ch >= 65 && ch <= 90) ||
						(ch >= 97 && ch <= 122) ||
						(ch >= 48 && ch <= 57) ||
						ch === 43 ||
						ch === 47 ||
						ch === 61
					) {
						end++;
					} else {
						break;
					}
				}

				const b64 = part.slice(base64Start, end);
				if (b64.length > 0) {
					imageObjects.push({
						b64_json: b64,
						revised_prompt: request.prompt,
					});
				}
			}
		}
	}

	// If still no images, return error
	if (imageObjects.length === 0) {
		logger.warn("Images API - no images found in chat completions response", {
			model: request.model,
			hasContent: !!chatResponse.choices?.[0]?.message?.content,
			hasImages: !!chatResponse.choices?.[0]?.message?.images,
			contentPreview: chatResponse.choices?.[0]?.message?.content?.slice(
				0,
				200,
			),
		});
		throw new HTTPException(500, {
			message:
				"The model did not generate any images. Try a different model with image generation capabilities (e.g., gemini-2.5-flash-image, gemini-3-pro-image-preview).",
		});
	}

	// Build the OpenAI-compatible images response
	const imagesResponse = {
		created: Math.floor(Date.now() / 1000),
		data: imageObjects,
	};

	logger.debug("Images API - returning response", {
		imageCount: imageObjects.length,
		model: request.model,
	});

	return c.json(imagesResponse);
});
