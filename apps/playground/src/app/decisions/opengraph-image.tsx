import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt =
	"Decision Studio — typed answers with probabilities from decision models";
export const size = ogSize;
export const contentType = ogContentType;

export default function DecisionStudioOgImage() {
	return loungeOgImage({
		eyebrow: "Decision studio",
		title: "Typed answers with probabilities, not prose",
		subtitle:
			"Ask yes/no, pick-one, and rating questions about any text or image. Compare GPT-6 Luna, Microsoft-Decision-1, and Jev side by side.",
		path: "/decisions",
	});
}
