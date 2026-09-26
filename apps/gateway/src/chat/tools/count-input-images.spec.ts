import { describe, expect, it } from "vitest";

import { countInputImages } from "./count-input-images.js";

describe("countInputImages", () => {
	it("counts explicit image parts without charging for prose links", () => {
		expect(
			countInputImages([
				{
					content: [
						{
							type: "text",
							text: "Read https://example.com/docs and https://example.com/help",
						},
						{
							type: "image_url",
							image_url: { url: "https://example.com/image.png" },
						},
					],
				},
			]),
		).toBe(1);
	});
});
