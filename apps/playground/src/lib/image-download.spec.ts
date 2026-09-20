import { describe, expect, it } from "vitest";

import {
	imageFileExtension,
	imageFileStem,
	zipEntryName,
} from "@/lib/image-download";
import { historyImage, inlineImageFromDataUrl } from "@/lib/image-gen";

describe("image download names", () => {
	it("derives a filesystem-safe stem from the prompt", () => {
		expect(imageFileStem("A cat, on the Moon!")).toBe("a-cat-on-the-moon");
		expect(imageFileStem("   ")).toBe("image");
		expect(imageFileStem("x".repeat(80))).toHaveLength(48);
	});

	it("maps media types to extensions", () => {
		expect(imageFileExtension("image/png")).toBe("png");
		expect(imageFileExtension("image/jpeg")).toBe("jpg");
		expect(imageFileExtension("image/webp; charset=binary")).toBe("webp");
	});

	it("keeps colliding archive entries apart", () => {
		const taken = { "cat-1.png": true, "cat-1-2.png": true };
		expect(zipEntryName(taken, "cat-1", "png")).toBe("cat-1-3.png");
		expect(zipEntryName(taken, "cat-1", "jpg")).toBe("cat-1.jpg");
		expect(zipEntryName({}, "cat-2", "png")).toBe("cat-2.png");
	});
});

describe("gallery image sources", () => {
	it("addresses saved images by variant URL", () => {
		expect(historyImage("https://api.test", "abc", 1, 2)).toEqual({
			kind: "remote",
			previewUrl:
				"https://api.test/playground/image-history/abc/images/1/2?variant=preview",
			fullUrl: "https://api.test/playground/image-history/abc/images/1/2",
		});
	});

	it("strips the data URL prefix from inline input images", () => {
		expect(
			inlineImageFromDataUrl({
				dataUrl: "data:image/png;base64,aGVsbG8=",
				mediaType: "image/png",
			}),
		).toEqual({ kind: "inline", base64: "aGVsbG8=", mediaType: "image/png" });
	});
});
