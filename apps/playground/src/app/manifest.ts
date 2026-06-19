import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "LLM Gateway Playground",
		short_name: "LLM Gateway",
		description:
			"Test and compare 280+ AI models in one playground. Chat, image, video, and group-chat across providers.",
		start_url: "/",
		display: "standalone",
		background_color: "#ffffff",
		theme_color: "#ffffff",
		icons: [
			{
				src: "/favicon/android-chrome-192x192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/favicon/android-chrome-512x512.png",
				sizes: "512x512",
				type: "image/png",
			},
		],
	};
}
