import { describe, expect, test, vi } from "vitest";

import { transformAnthropicMessages } from "./transform-anthropic-messages.js";

const processImageUrl = vi.hoisted(() => vi.fn());

vi.mock("./process-image-url.js", async (importOriginal) => ({
	...(await importOriginal()),
	processImageUrl,
}));

describe("transformAnthropicMessages image fetch failures", () => {
	test("propagates a failed image fetch instead of substituting prompt text", async () => {
		const error = new Error("Failed to process image from URL");
		processImageUrl.mockRejectedValueOnce(error);

		await expect(
			transformAnthropicMessages([
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { url: "https://example.com/image.png" },
						},
					],
				},
			]),
		).rejects.toBe(error);
	});
});
