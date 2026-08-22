import { describe, expect, it } from "vitest";

import { dynamicRouteGraphSchema } from "@llmgateway/shared/dynamic-route";

import {
	DynamicRouteEvaluationError,
	type DynamicRouteEvaluationContext,
	evaluateDynamicRoute,
} from "./evaluate-dynamic-route.js";

import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

function makeContext(
	overrides: Partial<DynamicRouteEvaluationContext> = {},
): DynamicRouteEvaluationContext {
	return {
		getHeader: () => undefined,
		body: {},
		metadata: {
			orgId: "org-1",
			projectId: "project-1",
			apiKeyId: "key-1",
			plan: "enterprise",
		},
		splitKey: "session-1",
		...overrides,
	};
}

describe("evaluateDynamicRoute", () => {
	it("resolves a plain model node", () => {
		const graph: DynamicRouteGraph = {
			entry: "m",
			nodes: [
				{ id: "m", type: "model", model: "gpt-5-nano", providers: ["openai"] },
			],
		};
		const result = evaluateDynamicRoute(graph, makeContext());
		expect(result).toEqual({
			status: "model",
			model: "gpt-5-nano",
			providers: ["openai"],
			path: ["m"],
		});
	});

	it("returns end status for an end node", () => {
		const graph: DynamicRouteGraph = {
			entry: "e",
			nodes: [{ id: "e", type: "end" }],
		};
		expect(evaluateDynamicRoute(graph, makeContext())).toEqual({
			status: "end",
			path: ["e"],
		});
	});

	it("follows the first matching condition", () => {
		const graph: DynamicRouteGraph = {
			entry: "c",
			nodes: [
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x-tier" },
							op: "eq",
							value: "paid",
							next: "paid",
						},
						{
							field: { source: "header", path: "x-tier" },
							op: "exists",
							next: "known",
						},
					],
					else: "free",
				},
				{ id: "paid", type: "model", model: "gpt-5-nano" },
				{ id: "known", type: "model", model: "gemini-2.5-flash" },
				{ id: "free", type: "end" },
			],
		};
		expect(
			evaluateDynamicRoute(graph, makeContext({ getHeader: () => "paid" })),
		).toMatchObject({ model: "gpt-5-nano", path: ["c", "paid"] });
		expect(
			evaluateDynamicRoute(graph, makeContext({ getHeader: () => "trial" })),
		).toMatchObject({ model: "gemini-2.5-flash" });
		expect(evaluateDynamicRoute(graph, makeContext())).toEqual({
			status: "end",
			path: ["c", "free"],
		});
	});

	it("matches conditions against dot-paths into the body", () => {
		const graph: DynamicRouteGraph = {
			entry: "c",
			nodes: [
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "body", path: "metadata.segment" },
							op: "in",
							value: ["beta", "internal"],
							next: "beta",
						},
					],
					else: "default",
				},
				{ id: "beta", type: "model", model: "gpt-5-nano" },
				{ id: "default", type: "model", model: "gemini-2.5-flash" },
			],
		};
		expect(
			evaluateDynamicRoute(
				graph,
				makeContext({ body: { metadata: { segment: "beta" } } }),
			),
		).toMatchObject({ model: "gpt-5-nano" });
		expect(
			evaluateDynamicRoute(
				graph,
				makeContext({ body: { metadata: { segment: "public" } } }),
			),
		).toMatchObject({ model: "gemini-2.5-flash" });
	});

	it("matches conditions against request metadata", () => {
		const graph: DynamicRouteGraph = {
			entry: "c",
			nodes: [
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "metadata", path: "plan" },
							op: "eq",
							value: "enterprise",
							next: "big",
						},
					],
					else: "small",
				},
				{ id: "big", type: "model", model: "gpt-5-nano" },
				{ id: "small", type: "model", model: "gemini-2.5-flash" },
			],
		};
		expect(evaluateDynamicRoute(graph, makeContext())).toMatchObject({
			model: "gpt-5-nano",
		});
	});

	it("supports numeric comparisons", () => {
		const graph: DynamicRouteGraph = {
			entry: "c",
			nodes: [
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "body", path: "max_tokens" },
							op: "gt",
							value: 1000,
							next: "big",
						},
					],
					else: "small",
				},
				{ id: "big", type: "model", model: "gpt-5-nano" },
				{ id: "small", type: "model", model: "gemini-2.5-flash" },
			],
		};
		expect(
			evaluateDynamicRoute(graph, makeContext({ body: { max_tokens: 2000 } })),
		).toMatchObject({ model: "gpt-5-nano" });
		expect(
			evaluateDynamicRoute(graph, makeContext({ body: { max_tokens: 100 } })),
		).toMatchObject({ model: "gemini-2.5-flash" });
	});

	it("only satisfies neq for missing fields", () => {
		const graph: DynamicRouteGraph = {
			entry: "c",
			nodes: [
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x-absent" },
							op: "neq",
							value: "anything",
							next: "neq",
						},
					],
					else: "else",
				},
				{ id: "neq", type: "model", model: "gpt-5-nano" },
				{ id: "else", type: "end" },
			],
		};
		expect(evaluateDynamicRoute(graph, makeContext())).toMatchObject({
			model: "gpt-5-nano",
		});
	});

	it("splits percentages deterministically per split key", () => {
		const graph: DynamicRouteGraph = {
			entry: "p",
			nodes: [
				{
					id: "p",
					type: "percentage",
					splits: [
						{ weight: 50, next: "a" },
						{ weight: 50, next: "b" },
					],
				},
				{ id: "a", type: "model", model: "gpt-5-nano" },
				{ id: "b", type: "model", model: "gemini-2.5-flash" },
			],
		};
		const first = evaluateDynamicRoute(
			graph,
			makeContext({ splitKey: "session-42" }),
		);
		for (let i = 0; i < 10; i++) {
			expect(
				evaluateDynamicRoute(graph, makeContext({ splitKey: "session-42" })),
			).toEqual(first);
		}
	});

	it("distributes percentage splits roughly by weight", () => {
		const graph: DynamicRouteGraph = {
			entry: "p",
			nodes: [
				{
					id: "p",
					type: "percentage",
					splits: [
						{ weight: 90, next: "a" },
						{ weight: 10, next: "b" },
					],
				},
				{ id: "a", type: "model", model: "gpt-5-nano" },
				{ id: "b", type: "model", model: "gemini-2.5-flash" },
			],
		};
		let aCount = 0;
		const total = 1000;
		for (let i = 0; i < total; i++) {
			const result = evaluateDynamicRoute(
				graph,
				makeContext({ splitKey: `session-${i}` }),
			);
			if (result.status === "model" && result.model === "gpt-5-nano") {
				aCount++;
			}
		}
		expect(aCount).toBeGreaterThan(total * 0.8);
		expect(aCount).toBeLessThan(total * 0.97);
	});

	it("chains percentage into conditional nodes", () => {
		const graph: DynamicRouteGraph = {
			entry: "p",
			nodes: [
				{
					id: "p",
					type: "percentage",
					splits: [
						{ weight: 100, next: "c" },
						{ weight: 0.0001, next: "dead" },
					],
				},
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "metadata", path: "plan" },
							op: "eq",
							value: "enterprise",
							next: "m",
						},
					],
					else: "dead",
				},
				{ id: "m", type: "model", model: "gpt-5-nano" },
				{ id: "dead", type: "end" },
			],
		};
		expect(evaluateDynamicRoute(graph, makeContext())).toMatchObject({
			model: "gpt-5-nano",
			path: ["p", "c", "m"],
		});
	});

	it("throws when the graph exceeds the hop bound", () => {
		// A two-node cycle bypassing save-time validation must not loop forever.
		const graph = {
			entry: "a",
			nodes: [
				{
					id: "a",
					type: "conditional",
					conditions: [
						{
							field: { source: "metadata", path: "plan" },
							op: "exists",
							next: "b",
						},
					],
					else: "b",
				},
				{
					id: "b",
					type: "conditional",
					conditions: [
						{
							field: { source: "metadata", path: "plan" },
							op: "exists",
							next: "a",
						},
					],
					else: "a",
				},
			],
		} as DynamicRouteGraph;
		expect(() => evaluateDynamicRoute(graph, makeContext())).toThrow(
			DynamicRouteEvaluationError,
		);
		expect(() => evaluateDynamicRoute(graph, makeContext())).toThrow(/maximum/);
	});

	it("throws on unknown node references", () => {
		const graph = {
			entry: "missing",
			nodes: [{ id: "m", type: "model", model: "gpt-5-nano" }],
		} as DynamicRouteGraph;
		expect(() => evaluateDynamicRoute(graph, makeContext())).toThrow(
			DynamicRouteEvaluationError,
		);
		expect(() => evaluateDynamicRoute(graph, makeContext())).toThrow(
			/unknown node/,
		);
	});
});

describe("dynamicRouteGraphSchema", () => {
	it("accepts a valid graph", () => {
		const result = dynamicRouteGraphSchema.safeParse({
			entry: "p",
			nodes: [
				{
					id: "p",
					type: "percentage",
					splits: [
						{ weight: 50, next: "a" },
						{ weight: 50, next: "b" },
					],
				},
				{ id: "a", type: "model", model: "gpt-5-nano" },
				{
					id: "b",
					type: "model",
					model: "gemini-2.5-flash",
					providers: ["google-ai-studio"],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("accepts custom model references without provider overrides", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [
					{
						id: "m",
						type: "model",
						model: "private-provider/private-model",
					},
				],
			}).success,
		).toBe(true);
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [
					{
						id: "m",
						type: "model",
						model: "private-provider/private-model",
						providers: ["openai"],
					},
				],
			}).success,
		).toBe(false);
	});

	it("rejects unknown models and providers", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [{ id: "m", type: "model", model: "not-a-real-model" }],
			}).success,
		).toBe(false);
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [
					{
						id: "m",
						type: "model",
						model: "gpt-5-nano",
						providers: ["not-a-provider"],
					},
				],
			}).success,
		).toBe(false);
	});

	it("rejects providers that do not serve the model", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [
					{
						id: "m",
						type: "model",
						model: "gpt-5-nano",
						providers: ["anthropic"],
					},
				],
			}).success,
		).toBe(false);
	});

	it("rejects dangling node references", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "c",
				nodes: [
					{
						id: "c",
						type: "conditional",
						conditions: [
							{
								field: { source: "header", path: "x-a" },
								op: "exists",
								next: "missing",
							},
						],
						else: "c2",
					},
					{ id: "c2", type: "end" },
				],
			}).success,
		).toBe(false);
	});

	it("rejects duplicate node ids and unreachable nodes", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [
					{ id: "m", type: "model", model: "gpt-5-nano" },
					{ id: "m", type: "end" },
				],
			}).success,
		).toBe(false);
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "m",
				nodes: [
					{ id: "m", type: "model", model: "gpt-5-nano" },
					{ id: "orphan", type: "end" },
				],
			}).success,
		).toBe(false);
	});

	it("rejects op/value mismatches", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "c",
				nodes: [
					{
						id: "c",
						type: "conditional",
						conditions: [
							{
								field: { source: "header", path: "x-a" },
								op: "gt",
								value: "not-a-number",
								next: "m",
							},
						],
						else: "m",
					},
					{ id: "m", type: "model", model: "gpt-5-nano" },
				],
			}).success,
		).toBe(false);
	});
});

describe("dynamicRouteGraphSchema review-hardening rules", () => {
	it("rejects cyclic graphs at validation time", () => {
		const result = dynamicRouteGraphSchema.safeParse({
			entry: "a",
			nodes: [
				{
					id: "a",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x-a" },
							op: "exists",
							next: "b",
						},
					],
					else: "b",
				},
				{
					id: "b",
					type: "conditional",
					conditions: [
						{
							field: { source: "header", path: "x-b" },
							op: "exists",
							next: "a",
						},
					],
					else: "a",
				},
			],
		});
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toMatch(/cycle/);
	});

	it("rejects node ids with unsafe characters", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "a:b",
				nodes: [{ id: "a:b", type: "model", model: "gpt-5-nano" }],
			}).success,
		).toBe(false);
	});

	it("rejects unknown metadata paths", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "c",
				nodes: [
					{
						id: "c",
						type: "conditional",
						conditions: [
							{
								field: { source: "metadata", path: "projcetId" },
								op: "exists",
								next: "m",
							},
						],
						else: "m",
					},
					{ id: "m", type: "model", model: "gpt-5-nano" },
				],
			}).success,
		).toBe(false);
	});

	it("rejects array values for non-in operators", () => {
		expect(
			dynamicRouteGraphSchema.safeParse({
				entry: "c",
				nodes: [
					{
						id: "c",
						type: "conditional",
						conditions: [
							{
								field: { source: "header", path: "x-a" },
								op: "eq",
								value: ["a", "b"],
								next: "m",
							},
						],
						else: "m",
					},
					{ id: "m", type: "model", model: "gpt-5-nano" },
				],
			}).success,
		).toBe(false);
	});

	it("does not resolve prototype keys from metadata or body", () => {
		const graph: DynamicRouteGraph = {
			entry: "c",
			nodes: [
				{
					id: "c",
					type: "conditional",
					conditions: [
						{
							field: { source: "body", path: "constructor" },
							op: "exists",
							next: "leak",
						},
					],
					else: "safe",
				},
				{ id: "leak", type: "end" },
				{ id: "safe", type: "model", model: "gpt-5-nano" },
			],
		};
		expect(evaluateDynamicRoute(graph, makeContext())).toMatchObject({
			model: "gpt-5-nano",
		});
	});
});
