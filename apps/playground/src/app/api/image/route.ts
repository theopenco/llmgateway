import { generateImage } from "ai";
import { cookies } from "next/headers";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";
import { describeImageGenerationError } from "@/lib/image-gen";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

export const maxDuration = 300; // 5 minutes

interface ImageRequestBody {
	prompt: string;
	model?: string;
	apiKey?: string;
	provider?: string;
	image_config?: {
		aspect_ratio?:
			| "auto"
			| "1:1"
			| "9:16"
			| "16:9"
			| "3:4"
			| "4:3"
			| "3:2"
			| "2:3"
			| "5:4"
			| "4:5"
			| "21:9"
			| "1:4"
			| "4:1"
			| "1:8"
			| "8:1";
		image_size?: "0.5K" | "1K" | "2K" | "4K" | string;
		image_quality?: "auto" | "low" | "medium" | "high" | string;
		n?: number;
	};
	input_images?: { url: string; mediaType: string }[];
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body = await req.json();
	const {
		prompt,
		model,
		apiKey,
		provider,
		image_config,
		input_images,
	}: ImageRequestBody = body;

	if (!prompt?.trim()) {
		return new Response(
			JSON.stringify({ error: "Missing prompt for image generation" }),
			{ status: 400 },
		);
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") ?? undefined;
	const noFallbackHeader = req.headers.get("x-no-fallback") ?? undefined;

	const cookieStore = await cookies();
	const cookieApiKey = getPlaygroundKeyForRequest(cookieStore);
	const finalApiKey = apiKey ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseURL: getGatewayApiBaseUrl(),
		headers: {
			"x-source": LOUNGE_SOURCE,
			...(noFallbackHeader ? { "x-no-fallback": noFallbackHeader } : {}),
		},
		extraBody: {
			image_config,
		},
	}) as any;

	let selectedModel = (model ?? "auto") as string;
	if (!model && provider && typeof provider === "string") {
		const alreadyPrefixed = String(selectedModel).includes("/");
		if (!alreadyPrefixed) {
			selectedModel = `${provider}/${selectedModel}`;
		}
	}

	let generation: ReturnType<typeof generateImage>;
	try {
		generation = generateImage({
			model: llmgateway.image(selectedModel),
			prompt:
				input_images && input_images.length > 0
					? {
							images: input_images.map((fp) => fp.url),
							text: prompt,
						}
					: prompt,
			n: image_config?.n ?? 1,
			...(image_config?.image_size
				? { size: image_config.image_size as `${number}x${number}` }
				: {}),
			...(image_config?.aspect_ratio && image_config.aspect_ratio !== "auto"
				? { aspectRatio: image_config.aspect_ratio }
				: {}),
			...(image_config?.image_quality
				? {
						providerOptions: {
							llmgateway: { quality: image_config.image_quality },
						},
					}
				: {}),
		});
	} catch (error: unknown) {
		const { message, status } = describeImageGenerationError(error);
		return new Response(JSON.stringify({ error: message }), { status });
	}

	// Image generation can run for minutes (gpt-image-2 at high quality),
	// far past typical proxy/load-balancer idle timeouts. A buffered JSON
	// response sends zero bytes until the model finishes, so the connection
	// gets killed upstream while the gateway request still completes — the
	// user sees a failure but the image shows up in their activity. Stream
	// newline-delimited JSON keepalive pings while waiting, then deliver the
	// result (or error) in-band, mirroring the chat route's SSE keepalives.
	const KEEPALIVE_INTERVAL_MS = 15_000;
	const encoder = new TextEncoder();
	let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			keepaliveTimer = setInterval(() => {
				try {
					controller.enqueue(
						encoder.encode(JSON.stringify({ ping: 1 }) + "\n"),
					);
				} catch {
					clearInterval(keepaliveTimer);
				}
			}, KEEPALIVE_INTERVAL_MS);

			void (async () => {
				try {
					const result = await generation;
					const images = result.images.map((image) => ({
						base64: image.base64,
						mediaType: image.mediaType || "image/png",
					}));
					controller.enqueue(encoder.encode(JSON.stringify({ images }) + "\n"));
				} catch (error: unknown) {
					const { message, status } = describeImageGenerationError(error);
					try {
						controller.enqueue(
							encoder.encode(JSON.stringify({ error: message, status }) + "\n"),
						);
					} catch {
						// stream cancelled/closed — nothing to deliver to
					}
				} finally {
					clearInterval(keepaliveTimer);
					try {
						controller.close();
					} catch {
						// already closed/errored
					}
				}
			})();
		},
		cancel() {
			clearInterval(keepaliveTimer);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Cache-Control": "no-cache",
			"X-Accel-Buffering": "no",
		},
	});
}
