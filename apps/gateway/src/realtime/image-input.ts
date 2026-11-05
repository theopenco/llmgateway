import { resolveImageFetchTimeoutMs } from "@/chat/tools/convert-images-to-base64.js";
import { raceClientAbort } from "@/lib/client-abort.js";

import { processImageUrl } from "@llmgateway/actions";

import { supportsRealtimeImageInput } from "./pricing.js";

import type { ProviderModelMapping } from "@llmgateway/models";

const IMAGE_SIZE_LIMIT_MB = 10;
const IMAGE_MEDIA_TYPE = /^image\/(?:png|jpeg|webp|gif)$/i;

export async function prepareRealtimeImageInput(
	input: unknown,
	mapping: ProviderModelMapping,
	signal: AbortSignal,
): Promise<{ code: string; message: string } | null> {
	if (!Array.isArray(input)) {
		return null;
	}
	const images: Record<string, unknown>[] = [];
	for (const item of input as unknown[]) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const content = (item as Record<string, unknown>).content;
		if (Array.isArray(content)) {
			for (const part of content as unknown[]) {
				if (
					part &&
					typeof part === "object" &&
					(part as Record<string, unknown>).type === "input_image"
				) {
					images.push(part as Record<string, unknown>);
				}
			}
		}
	}
	if (images.length === 0) {
		return null;
	}
	if (!supportsRealtimeImageInput(mapping)) {
		return {
			code: "image_input_not_supported",
			message: "This realtime model does not support metered image input.",
		};
	}
	const controller = new AbortController();
	const combined = AbortSignal.any([signal, controller.signal]);
	const timeout = setTimeout(
		() =>
			controller.abort(
				new DOMException("Realtime image download timed out", "TimeoutError"),
			),
		resolveImageFetchTimeoutMs(),
	);
	let remainingBytes = IMAGE_SIZE_LIMIT_MB * 1024 * 1024;
	try {
		for (const image of images) {
			combined.throwIfAborted();
			const url = image.image_url;
			if (
				typeof url !== "string" ||
				(!/^https:\/\//i.test(url) &&
					!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(
						url,
					))
			) {
				return {
					code: "invalid_image_url",
					message:
						"Realtime images require a public HTTPS URL or inline base64 PNG, JPEG, WebP or GIF.",
				};
			}
			const processed = await raceClientAbort(
				processImageUrl(
					url,
					false,
					remainingBytes / (1024 * 1024),
					null,
					combined,
				),
				combined,
				controller,
			);
			combined.throwIfAborted();
			const mimeType = processed?.mimeType.split(";")[0]?.trim().toLowerCase();
			if (!mimeType || !IMAGE_MEDIA_TYPE.test(mimeType)) {
				return {
					code: "invalid_image_url",
					message: "Realtime images must be PNG, JPEG, WebP or GIF.",
				};
			}
			remainingBytes -= Buffer.byteLength(processed.data, "base64");
			if (remainingBytes < 0) {
				return {
					code: "invalid_image_url",
					message: "Realtime image inputs exceed the 10 MB event limit.",
				};
			}
			image.image_url = `data:${mimeType};base64,${processed.data}`;
		}
		return null;
	} catch {
		return {
			code: "invalid_image_url",
			message:
				"Realtime image download failed, exceeded its size limit or timed out.",
		};
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}
