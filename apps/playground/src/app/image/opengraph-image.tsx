import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt =
	"AI image generator — DALL·E, Flux, Stable Diffusion side by side";
export const size = ogSize;
export const contentType = ogContentType;

export default function ImageStudioOgImage() {
	return loungeOgImage({
		eyebrow: "Image studio",
		title: "AI image generation, side by side",
		subtitle:
			"DALL·E, Flux, Stable Diffusion, and Seedream — one prompt, up to four variants, one membership.",
		path: "/image",
	});
}
