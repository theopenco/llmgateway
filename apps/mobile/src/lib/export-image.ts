import { exportFile } from "@/lib/export-file";

import type { GeneratedImage } from "@/api/images";

export async function exportImage(
	image: GeneratedImage,
	action: "save" | "share",
) {
	const extension =
		image.mediaType === "image/jpeg"
			? "jpg"
			: image.mediaType === "image/webp"
				? "webp"
				: "png";
	await exportFile(
		{ base64: image.base64, name: `image.${extension}` },
		action,
	);
}
