import { describe, expect, test } from "vitest";

import { models } from "@llmgateway/models";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	ModelDefinition,
	ProviderModelMapping,
	BaseMessage,
} from "@llmgateway/models";

const catalogue: readonly ModelDefinition[] = models;
const snapshot = catalogue.find(
	(model) => model.id === "deepseek-v4-flash-0731",
)!;
const mappings = snapshot.providers.flatMap((mapping) =>
	(mapping.regions ?? [null]).map((region) => ({
		mapping,
		region: region?.id ?? null,
	})),
);

function prepare(
	model: string,
	mapping: ProviderModelMapping,
	region: string | null,
	effort: "none" | "high",
	stream: boolean,
) {
	return prepareRequestBody(
		mapping.providerId,
		model,
		region,
		mapping.externalId,
		[
			{ role: "developer", content: "Answer briefly." },
			{ role: "user", content: "Weather?" },
			{
				role: "assistant",
				content: "",
				reasoning: "Look up weather",
				tool_calls: [
					{
						id: "call_weather",
						type: "function",
						function: { name: "weather", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_weather", content: "Sunny" },
		] as unknown as BaseMessage[],
		stream,
		0.5,
		1024,
		undefined,
		undefined,
		undefined,
		undefined,
		[
			{
				type: "function",
				function: {
					name: "weather",
					parameters: { type: "object", properties: {} },
				},
			},
		],
		"required",
		effort,
		true,
	);
}

describe.each([false, true])(
	"July snapshot request shaping (stream=%s)",
	(stream) => {
		test.each(mappings)(
			"preserves $mapping.providerId $region upstream body",
			async ({ mapping, region }) => {
				for (const effort of ["none", "high"] as const) {
					const oldBody = await prepare(
						"deepseek-v4-flash",
						mapping,
						region,
						effort,
						stream,
					);
					const newBody = await prepare(
						snapshot.id,
						mapping,
						region,
						effort,
						stream,
					);
					expect(newBody).toEqual(oldBody);
					expect(newBody).toMatchObject({ model: mapping.externalId });
				}
			},
		);

		test("keeps Alibaba native thinking budgets below output limit in every region", async () => {
			for (const { mapping, region } of mappings.filter(
				({ mapping }) => mapping.providerId === "alibaba",
			)) {
				const disabled = await prepare(
					snapshot.id,
					mapping,
					region,
					"none",
					stream,
				);
				expect(disabled).toMatchObject({ enable_thinking: false });
				expect(disabled).not.toHaveProperty("reasoning_effort");
				expect(
					await prepare(snapshot.id, mapping, region, "high", stream),
				).toMatchObject({
					enable_thinking: true,
					thinking_budget: 1023,
					max_tokens: 1024,
				});
			}
		});

		test("keeps Cloudflare thinking toggle and developer-role rewrite", async () => {
			const mapping = snapshot.providers.find(
				(entry) => entry.providerId === "cloudflare",
			)!;
			expect(
				await prepare(snapshot.id, mapping, null, "none", stream),
			).toMatchObject({
				chat_template_kwargs: { thinking: false },
				messages: [
					expect.objectContaining({ role: "system" }),
					expect.anything(),
					expect.objectContaining({ reasoning_content: "Look up weather" }),
					expect.anything(),
				],
			});
		});
	},
);
