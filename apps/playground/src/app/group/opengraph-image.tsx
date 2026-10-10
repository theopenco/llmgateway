import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Group chat — your AI council";
export const size = ogSize;
export const contentType = ogContentType;

export default function GroupChatOgImage() {
	return loungeOgImage({
		eyebrow: "Group chat",
		title: "One topic. A council of minds.",
		subtitle:
			"Choose your models and let them debate: taking turns, challenging arguments, and bringing new perspectives to the table.",
		path: "/group",
	});
}
