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

test("requests one SVG from models with SVG output", async () => {
	const result = await generateImages(
		"project",
		"A cactus sticker",
		{ ...defaultImageSettings("gpt-image-2.6-flare"), format: "svg" },
		[],
		3,
	);
	expect(post).toHaveBeenCalledWith("/v1/images/generations", {
		body: expect.objectContaining({
			model: "gpt-image-2.6-flare",
			n: 1,
			output_format: "svg",
		}),
	});
	expect(result.images[0].mediaType).toBe("image/svg+xml");
});

test("ignores the SVG format for models without SVG output and for edits", async () => {
	await generateImages(
		"project",
		"A tree",
		{ ...defaultImageSettings("gpt-image-2"), format: "svg" },
		[],
		2,
	);
	expect(post.mock.calls[0][1].body).not.toHaveProperty("output_format");
	expect(post.mock.calls[0][1].body.n).toBe(2);
	await generateImages(
		"project",
		"Watercolor",
		{ ...defaultImageSettings("gpt-image-2.6-flare"), format: "svg" },
		[{ base64: "reference", mediaType: "image/png" }],
		1,
	);
	expect(post.mock.calls[1][0]).toBe("/v1/images/edits");
	expect(post.mock.calls[1][1].body).not.toHaveProperty("output_format");
});

test("rejects empty and filtered image responses", async () => {
	post.mockResolvedValue({ data: { data: [] } });
	await expect(
		generateImages("project", "A tree", defaultImageSettings(), [], 1),
	).rejects.toThrow("no images");
});
