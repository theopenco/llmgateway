import { productOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"Lounge: chat, images, video and voice in one app, with the image studio";

export default function Image() {
	return productOgImage({
		gate: "D",
		audience: "Everyone at work",
		title: "Chat, images,",
		titleAccent: "video and voice.",
		subtitle:
			"GPT, Claude and Gemini in one app, with group chats and studios. Fast models from $9/mo, flagship models from $19/mo.",
		screenshot: "lounge-image-dark.webp",
		accent: "#fcd34d",
		glow: "rgba(245,158,11,0.28)",
	});
}
