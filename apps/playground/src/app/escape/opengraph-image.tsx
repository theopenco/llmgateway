import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Sandbox Escape — can your LLM break out?";
export const size = ogSize;
export const contentType = ogContentType;

export default function EscapeOgImage() {
	return loungeOgImage({
		eyebrow: "Sandbox Escape",
		title: "Can your LLM break out?",
		subtitle:
			"Every model gets the same five maps. One API call per step. See which one actually escapes.",
		path: "/escape",
	});
}
