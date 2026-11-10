import { describe, expect, test } from "vitest";

import {
	getContextTierMinSize,
	getReferenceContextSize,
} from "./context-tier.js";
import { deepseekModels } from "./models/deepseek.js";
import { isLiveMapping } from "./providers.js";

import type { ModelDefinition } from "./models.js";

const catalogue: ModelDefinition[] = deepseekModels;
const root = catalogue.find((model) => model.id === "deepseek-v4-flash")!;
const snapshot = () =>
	catalogue.find((model) => model.id === "deepseek-v4-flash-0731");
const migrated = [
	"novita",
	"alibaba",
	"deepinfra",
	"bytedance",
	"baidu",
	"tencent",
	"cloudflare",
];

describe("DeepSeek V4 Flash July snapshot migration", () => {
	test("adds a canonical snapshot without replacing the root", () => {
		expect(root.name).toBe("DeepSeek V4 Flash");
		expect(root.releasedAt).toEqual(new Date("2026-04-24"));
		expect(snapshot()).toMatchObject({
			name: "DeepSeek V4 Flash 0731",
			family: "deepseek",
			releasedAt: new Date("2026-07-31"),
		});
		expect(snapshot()?.output).toEqual(root.output);
		expect(snapshot()?.providers.map((mapping) => mapping.providerId)).toEqual(
			migrated,
		);
	});

	test.each(migrated)(
		"copies all %s metadata unchanged and gives the root notice",
		(providerId) => {
			const previous = root.providers.find(
				(mapping) => mapping.providerId === providerId,
			)!;
			const { deactivatedAt, ...metadata } = previous;
			expect(deactivatedAt).toEqual(new Date("2026-11-06"));
			expect(
				snapshot()?.providers.find(
					(mapping) => mapping.providerId === providerId,
				),
			).toEqual(metadata);
		},
	);

	test("preserves all regional constraints and prices", () => {
		expect(
			snapshot()
				?.providers.find((mapping) => mapping.providerId === "alibaba")
				?.regions?.map((region) => region.id),
		).toEqual(["singapore", "eu-frankfurt", "us-virginia", "cn-beijing"]);
		expect(
			snapshot()?.providers.find((mapping) => mapping.providerId === "baidu")
				?.maxOutput,
		).toBe(131072);
		expect(
			snapshot()?.providers.find((mapping) => mapping.providerId === "novita")
				?.contextSize,
		).toBe(1050000);
	});

	test("keeps retired and undated deployments only on the original root", () => {
		for (const providerId of [
			"deepseek",
			"fireworks",
			"together-ai",
			"ranoai",
			"canopywave",
		]) {
			expect(
				root.providers.some((mapping) => mapping.providerId === providerId),
			).toBe(true);
			expect(
				snapshot()?.providers.some(
					(mapping) => mapping.providerId === providerId,
				),
			).toBe(false);
		}
		expect(
			root.providers.find((mapping) => mapping.providerId === "fireworks")
				?.deactivatedAt,
		).toEqual(new Date("2026-10-19"));
		expect(
			root.providers.find((mapping) => mapping.providerId === "together-ai")
				?.deactivatedAt,
		).toEqual(new Date("2026-10-22"));
		for (const providerId of ["ranoai", "canopywave", "tencent"]) {
			expect(
				root.providers.find((mapping) => mapping.providerId === providerId)
					?.deactivatedAt,
			).toEqual(new Date("2026-11-06"));
		}
	});
});

describe("snapshot availability after the compatibility window", () => {
	test("keeps all snapshot deployments and the full reference window", () => {
		const now = new Date("2026-11-15");
		const model = snapshot()!;
		expect(
			model.providers.every((mapping) => isLiveMapping(mapping, now)),
		).toBe(true);
		expect(
			root.providers
				.filter((mapping) => migrated.includes(mapping.providerId))
				.some((mapping) => isLiveMapping(mapping, now)),
		).toBe(false);
		expect(getReferenceContextSize(model.id, [], now)).toBe(1050000);
		expect(getContextTierMinSize(model.id, model.providers, now)).toBe(945000);
		expect(
			getReferenceContextSize(
				model.id,
				[{ providerId: "custom", contextSize: 128000 }],
				now,
			),
		).toBe(1050000);
	});
});
