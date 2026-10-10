import { gatewayClient } from "@/api/gateway";
import { createVideo } from "@/api/videos";

jest.mock("@/api/gateway", () => ({ gatewayClient: jest.fn() }));
const post = jest.fn();
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(gatewayClient)
		.mockResolvedValue({ POST: post } as unknown as Awaited<
			ReturnType<typeof gatewayClient>
		>);
});

test("preserves the pinned provider, frame inputs, and asynchronous job ID", async () => {
	post.mockResolvedValue({ data: { id: "video-job", status: "queued" } });
	const request = {
		model: "xai/grok-imagine-video-1-5",
		prompt: "A moving cloud",
		seconds: 5,
		image: "data:image/png;base64,fixture",
		audio: false,
	};
	await expect(createVideo("project", request)).resolves.toMatchObject({
		jobId: "video-job",
		modelId: request.model,
		videoUrl: null,
	});
	expect(gatewayClient).toHaveBeenCalledWith("project", request.model);
	expect(post).toHaveBeenCalledWith("/v1/videos", { body: request });
});

test("keeps a failed comparison model separate from successful video jobs", async () => {
	post
		.mockResolvedValueOnce({ data: { id: "video-job" } })
		.mockRejectedValueOnce(new Error("Provider unavailable"));
	const results = await Promise.all(
		["first", "second"].map((model) =>
			createVideo("project", { model, prompt: "A tree", seconds: 5 }),
		),
	);
	expect(results[0]?.jobId).toBe("video-job");
	expect(results[1]).toMatchObject({
		jobId: null,
		error: "Provider unavailable",
	});
});

test("reports an invalid provider response without creating an untrackable success", async () => {
	post.mockResolvedValue({ data: {} });
	await expect(
		createVideo("project", { model: "model", prompt: "A tree", seconds: 5 }),
	).resolves.toMatchObject({
		jobId: null,
		error: "The provider did not return a video job.",
	});
});
