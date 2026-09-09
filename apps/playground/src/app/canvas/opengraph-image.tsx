import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Canvas — build UIs from JSON specs with live preview";
export const size = ogSize;
export const contentType = ogContentType;

export default function CanvasOgImage() {
	return loungeOgImage({
		eyebrow: "Canvas",
		title: "Build UIs from JSON specs",
		subtitle:
			"Generate and edit interactive UI specs with any of 200+ models, preview live, and export to PDF or PNG.",
		path: "/canvas",
	});
}
