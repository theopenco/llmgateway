import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "AI models for coding on DevPass";
export const size = ogSize;
export const contentType = ogContentType;

export default function CodingModelsOgImage() {
	return devpassOgImage({
		eyebrow: "Coding models",
		title: "AI models built for coding",
		subtitle:
			"Tool calling, JSON output, streaming, and prompt caching — the models that ship code, in one subscription.",
		path: "/coding-models",
	});
}
