import { zip } from "fflate";

import type { GalleryImage, GeneratedImage } from "@/lib/image-gen";

export function base64ToBlob(base64: string, mediaType: string): Blob {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new Blob([bytes], { type: mediaType });
}

export function imageFileExtension(mediaType: string): string {
	const subtype = mediaType.split("/")[1]?.split(";")[0] ?? "png";
	return subtype === "jpeg" ? "jpg" : subtype;
}

// Resolves the original bytes of a gallery image: inline images decode
// locally, saved ones fetch the full-resolution variant from the API.
export async function loadImageBlob(image: GalleryImage): Promise<Blob> {
	if (image.kind === "inline") {
		return base64ToBlob(image.base64, image.mediaType);
	}
	const response = await fetch(image.fullUrl, { credentials: "include" });
	if (!response.ok) {
		throw new Error(`Failed to load image (HTTP ${response.status})`);
	}
	return await response.blob();
}

export async function toGeneratedImage(
	image: GalleryImage,
): Promise<GeneratedImage> {
	if (image.kind === "inline") {
		return { base64: image.base64, mediaType: image.mediaType };
	}
	const blob = await loadImageBlob(image);
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () =>
			reject(reader.error ?? new Error("Failed to read image"));
		reader.readAsDataURL(blob);
	});
	const comma = dataUrl.indexOf(",");
	return {
		base64: dataUrl.slice(comma + 1),
		mediaType: blob.type || "image/png",
	};
}

function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Give the browser a tick to start the download before revoking.
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

// Filesystem-safe stem derived from the prompt, e.g. "a-cat-on-the-moon".
export function imageFileStem(prompt: string): string {
	const slug = prompt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "image";
}

export async function downloadImage(image: GalleryImage, stem: string) {
	const blob = await loadImageBlob(image);
	saveBlob(blob, `${stem}.${imageFileExtension(blob.type || "image/png")}`);
}

export interface ZipEntry {
	image: GalleryImage;
	stem: string;
}

// Bundles every image of a gallery item into one archive. Generated images
// are already compressed, so entries are stored rather than deflated.
export async function downloadImagesAsZip(entries: ZipEntry[], stem: string) {
	const blobs = await Promise.all(
		entries.map((entry) => loadImageBlob(entry.image)),
	);
	const files: Record<string, [Uint8Array, { level: 0 }]> = {};
	for (let index = 0; index < blobs.length; index++) {
		const blob = blobs[index]!;
		const name = `${entries[index]!.stem}.${imageFileExtension(blob.type || "image/png")}`;
		files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
	}
	const archive = await new Promise<Uint8Array>((resolve, reject) => {
		zip(files, (error, data) => (error ? reject(error) : resolve(data)));
	});
	saveBlob(
		new Blob([Uint8Array.from(archive)], { type: "application/zip" }),
		`${stem}.zip`,
	);
}
