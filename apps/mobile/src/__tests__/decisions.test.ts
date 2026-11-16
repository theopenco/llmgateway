import {
	acceptsImages,
	decisionCurl,
	decisionImage,
	runDecision,
} from "@/api/decisions";
import { gatewayClient } from "@/api/gateway";

import type { CatalogModel } from "@/components/ProviderOptions";

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

test("sends normalized questions and image parts to /v1/decisions", async () => {
	post.mockResolvedValue({
		data: {
			model: "jev",
			answers: [{ type: "predicate", name: "q1", probability: 0.8 }],
			usage: { input_tokens: 12, output_tokens: 0, total_tokens: 12 },
		},
	});
	const result = await runDecision(
		"project",
		"typesafe/jev",
		"Charged twice",
		[{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }],
		[{ type: "predicate", name: " ", instructions: " Is it urgent? " }],
	);
	expect(gatewayClient).toHaveBeenCalledWith("project", "typesafe/jev");
	expect(post).toHaveBeenCalledWith("/v1/decisions", {
		body: {
			model: "typesafe/jev",
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: "Charged twice" },
						{ type: "input_image", image_url: "data:image/png;base64,AAAA" },
					],
				},
			],
			questions: [
				{ type: "predicate", name: "q1", instructions: "Is it urgent?" },
			],
		},
	});
	expect(result.answers?.[0].probability).toBe(0.8);
	expect(result.usage?.input_tokens).toBe(12);
});

test("keeps a failed model as an error result instead of throwing", async () => {
	post.mockRejectedValue(new Error("Model unavailable"));
	await expect(
		runDecision(
			"project",
			"jev",
			"Hi",
			[],
			[{ type: "predicate", name: "a", instructions: "b" }],
		),
	).resolves.toMatchObject({ answers: null, error: "Model unavailable" });
});

test("accepts images only from vision mappings", () => {
	const models = [
		{
			id: "jev",
			mappings: [
				{ providerId: "typesafe", vision: true },
				{ providerId: "azure", region: "eu", vision: false },
			],
		},
	] as CatalogModel[];
	expect(acceptsImages("jev", models)).toBe(true);
	expect(acceptsImages("typesafe/jev", models)).toBe(true);
	expect(acceptsImages("azure/jev:eu", models)).toBe(false);
	expect(acceptsImages("other", models)).toBe(false);
});

test("rejects unsupported and oversized images", () => {
	expect(() => decisionImage("AAAA", "image/heic")).toThrow("PNG, JPEG");
	expect(() => decisionImage("A".repeat(2_000_001), "image/png")).toThrow(
		"smaller",
	);
	expect(decisionImage("AAAA", "image/png").dataUrl).toBe(
		"data:image/png;base64,AAAA",
	);
});

test("builds a cURL with image placeholders", () => {
	const curl = decisionCurl("jev", "It's late", 1, [
		{ type: "predicate", name: "late", instructions: "Late?" },
	]);
	expect(curl).toContain("https://api.llmgateway.io/v1/decisions");
	expect(curl).toContain("data:image/png;base64,…");
	expect(curl).toContain("It'\\''s late");
});
