import { generateImage } from "ai";
import { cookies } from "next/headers";

import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

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
	const cookieApiKey =
		cookieStore.get("llmgateway_playground_key")?.value ??
		cookieStore.get("__Host-llmgateway_playground_key")?.value;
	const finalApiKey = apiKey ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseURL: gatewayUrl,
		headers: {
			"x-source": "chat.llmgateway.io",
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

	try {
		const result = await generateImage({
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

		const images = result.images.map((image) => ({
			base64: image.base64,
			mediaType: image.mediaType || "image/png",
		}));

		return new Response(JSON.stringify({ images }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (error: unknown) {
		const status =
			typeof error === "object" &&
			error !== null &&
			"status" in error &&
			typeof (error as { status: unknown }).status === "number"
				? (error as { status: number }).status
				: 500;

		const message =
			error instanceof Error ? error.message : "Image generation failed";

		let detailedMessage: string | undefined;
		if (typeof error === "object" && error !== null) {
			const err = error as Record<string, unknown>;
			if (typeof err.responseBody === "string") {
				try {
					const body = JSON.parse(err.responseBody);
					if (typeof body.message === "string") {
						detailedMessage = body.message;
					}
				} catch {
					// ignore parse errors
				}
			}
		}

		return new Response(JSON.stringify({ error: detailedMessage ?? message }), {
			status,
		});
	}
}
