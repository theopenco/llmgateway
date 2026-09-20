import { useEffect, useState } from "react";

import { base64ToBlob } from "@/lib/image-download";

import type { GalleryImage } from "@/lib/image-gen";

export interface ResolvedGalleryImage {
	previewUrl: string;
	fullUrl: string;
	width?: number;
	height?: number;
	bytes?: number;
}

// Longest edge of a client-side preview. Matches the API's preview variant so
// a freshly generated image and its saved copy look the same in the grid.
const PREVIEW_EDGE = 1024;
// Object URLs are revoked shortly after their last consumer unmounts, so a
// remount (StrictMode, list reordering) can reuse the decoded preview.
const RELEASE_DELAY_MS = 2_000;

interface PreviewEntry {
	resolved: ResolvedGalleryImage | null;
	ready: Promise<ResolvedGalleryImage>;
	refs: number;
	urls: string[];
	// Set once the last consumer is gone and the URLs were revoked, so a
	// preview that finishes encoding afterwards is not stored and leaked.
	disposed: boolean;
}

const entries = new WeakMap<GalleryImage, PreviewEntry>();

async function encodePreview(
	bitmap: ImageBitmap,
	width: number,
	height: number,
): Promise<Blob> {
	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(width, height);
		canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
		return await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
	}
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Preview encoding failed")),
			"image/webp",
			0.85,
		);
	});
}

// Decodes the original once, off the render path, and keeps only a
// downscaled copy for the grid. The full-resolution bytes stay behind a blob
// URL that is not decoded until the image is zoomed.
async function buildPreview(
	blob: Blob,
	fullUrl: string,
	entry: PreviewEntry,
): Promise<ResolvedGalleryImage> {
	const bitmap = await createImageBitmap(blob);
	try {
		const scale = Math.min(
			1,
			PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height),
		);
		const base = {
			fullUrl,
			width: bitmap.width,
			height: bitmap.height,
			bytes: blob.size,
		};
		if (scale === 1) {
			return { ...base, previewUrl: fullUrl };
		}
		const preview = await encodePreview(
			bitmap,
			Math.round(bitmap.width * scale),
			Math.round(bitmap.height * scale),
		);
		if (entry.disposed) {
			return { ...base, previewUrl: fullUrl };
		}
		const previewUrl = URL.createObjectURL(preview);
		entry.urls.push(previewUrl);
		return { ...base, previewUrl };
	} finally {
		bitmap.close();
	}
}

function acquire(image: GalleryImage & { kind: "inline" }): PreviewEntry {
	let entry = entries.get(image);
	if (!entry) {
		const blob = base64ToBlob(image.base64, image.mediaType);
		const fullUrl = URL.createObjectURL(blob);
		const created: PreviewEntry = {
			resolved: null,
			ready: Promise.resolve(null as never),
			refs: 0,
			urls: [fullUrl],
			disposed: false,
		};
		created.ready = buildPreview(blob, fullUrl, created)
			.catch((error: unknown) => {
				// A format the browser cannot decode still renders through <img>
				// in some cases, so show the original rather than nothing.
				console.warn("Image preview generation failed", error);
				return { fullUrl, previewUrl: fullUrl, bytes: blob.size };
			})
			.then((resolved) => {
				created.resolved = resolved;
				return resolved;
			});
		entries.set(image, created);
		entry = created;
	}
	entry.refs++;
	return entry;
}

function release(image: GalleryImage, entry: PreviewEntry) {
	entry.refs--;
	setTimeout(() => {
		if (entry.refs > 0 || entries.get(image) !== entry) {
			return;
		}
		entries.delete(image);
		entry.disposed = true;
		for (const url of entry.urls) {
			URL.revokeObjectURL(url);
		}
	}, RELEASE_DELAY_MS);
}

// Resolves display URLs for a gallery image. Remote (saved) images are ready
// immediately; inline ones resolve once their preview has been generated.
export function useGalleryImage(
	image: GalleryImage | undefined,
): ResolvedGalleryImage | null {
	const [resolved, setResolved] = useState<ResolvedGalleryImage | null>(null);

	useEffect(() => {
		if (!image || image.kind !== "inline") {
			return;
		}
		const entry = acquire(image);
		let cancelled = false;
		setResolved(entry.resolved);
		void entry.ready.then((value) => {
			if (!cancelled) {
				setResolved(value);
			}
		});
		return () => {
			cancelled = true;
			release(image, entry);
		};
	}, [image]);

	if (!image) {
		return null;
	}
	if (image.kind === "remote") {
		return { previewUrl: image.previewUrl, fullUrl: image.fullUrl };
	}
	return resolved;
}
