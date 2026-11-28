export interface StoredImagePart {
	image_url?: {
		url?: string;
	};
}

export interface StoredImageFilePart {
	type: "file";
	mediaType: string;
	url: string;
}

export function isStoredImagePart(value: unknown): value is StoredImagePart {
	return (
		typeof value === "object" &&
		value !== null &&
		(!("image_url" in value) ||
			value.image_url === undefined ||
			(typeof value.image_url === "object" &&
				value.image_url !== null &&
				(!("url" in value.image_url) ||
					value.image_url.url === undefined ||
					typeof value.image_url.url === "string")))
	);
}

export function parseStoredImages(images: string): StoredImageFilePart[] {
	const parsedImages = JSON.parse(images) as unknown;
	if (!Array.isArray(parsedImages)) {
		return [];
	}

	return parsedImages.filter(isStoredImagePart).map((image) => {
		const dataUrl = image.image_url?.url ?? "";
		if (dataUrl.startsWith("data:")) {
			const [header, base64] = dataUrl.split(",");
			return {
				type: "file",
				mediaType: header.match(/data:([^;]+)/)?.[1] ?? "image/png",
				url: base64,
			};
		}
		return {
			type: "file",
			mediaType: "image/png",
			url: dataUrl,
		};
	});
}
