import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "AI video generator — Veo, Wan, and more in one place";
export const size = ogSize;
export const contentType = ogContentType;

export default function VideoStudioOgImage() {
	return loungeOgImage({
		eyebrow: "Video studio",
		title: "AI video generation in one place",
		subtitle:
			"Generate short videos with Google Veo, Alibaba Wan, and other text-to-video models — preview and compare inline.",
		path: "/video",
	});
}
