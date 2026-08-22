import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Lounge";

export default function Image() {
	return ogImage({
		eyebrow: "Lounge",
		title: "Every Frontier Model, One Membership",
		subtitle:
			"Chat with GPT, Claude, and Gemini, generate images, video, and audio, and run multi-model group chats — from $9/mo.",
	});
}
