import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Group chat — compare AI models side by side";
export const size = ogSize;
export const contentType = ogContentType;

export default function GroupChatOgImage() {
	return loungeOgImage({
		eyebrow: "Group chat",
		title: "One prompt. Every model. Side by side.",
		subtitle:
			"Send the same prompt to GPT, Claude, Gemini, Grok, and more at once and compare the streamed answers.",
		path: "/group",
	});
}
