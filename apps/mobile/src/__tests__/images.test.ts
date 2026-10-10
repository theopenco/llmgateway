import { gatewayClient } from "@/api/gateway";
import { defaultImageSettings, generateImages } from "@/api/images";

jest.mock("@/api/gateway", () => ({
	gatewayClient: jest.fn(),
	imageMediaType: () => "image/png",
}));

const post = jest.fn();
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(gatewayClient)
		.mockResolvedValue({ POST: post } as unknown as Awaited<
			ReturnType<typeof gatewayClient>
		>);
	post.mockResolvedValue({ data: { data: [{ b64_json: "fixture" }] } });
});

test("sends pixel size and quality without overriding them with aspect ratio", async () => {
	await generateImages(
		"project",
		"A tree",
		{
			...defaultImageSettings("gpt-image-2"),
			quality: "high",
			aspectRatio: "16:9",
		},
		[],
		2,
	);
	expect(post).toHaveBeenCalledWith("/v1/images/generations", {
		body: {
			model: "gpt-image-2",
			prompt: "A tree",
			n: 2,
			size: "1024x1024",
			quality: "high",
			moderation: "auto",
			response_format: "b64_json",
		},
	});
});

test("uses the editing endpoint with data URLs for references", async () => {
	await generateImages(
		"project",
		"Watercolor",
		defaultImageSettings("gpt-image-2"),
		[{ base64: "reference", mediaType: "image/png" }],
		1,
	);
	expect(post).toHaveBeenCalledWith("/v1/images/edits", {
		body: expect.objectContaining({
			images: [{ image_url: "data:image/png;base64,reference" }],
		}),
	});
});

test("rejects excess input images before making a billable request", async () => {
	await expect(
		generateImages(
			"project",
			"Combine",
			defaultImageSettings("grok-imagine-image-2-0"),
			Array.from({ length: 2 }, () => ({
				base64: "reference",
				mediaType: "image/png",
			})),
			1,
		),
	).rejects.toThrow("at most 1");
	expect(post).not.toHaveBeenCalled();
});

test("rejects empty and filtered image responses", async () => {
	post.mockResolvedValue({ data: { data: [] } });
	await expect(
		generateImages("project", "A tree", defaultImageSettings(), [], 1),
	).rejects.toThrow("no images");
});
