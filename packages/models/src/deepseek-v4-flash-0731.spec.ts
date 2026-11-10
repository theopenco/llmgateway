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

const original = ["deepinfra", "inference.net"];
const unchanged = migrated.filter(
	(providerId) => providerId !== "deepinfra" && providerId !== "tencent",
);
const live = (mappings: ModelDefinition["providers"], now = new Date()) =>
	mappings
		.filter((mapping) => isLiveMapping(mapping, now))
		.map((mapping) => mapping.providerId);

describe("DeepSeek V4 Flash July snapshot migration", () => {
	test("adds a canonical snapshot without replacing the root", () => {
		expect(root.name).toBe("DeepSeek V4 Flash");
		expect(root.releasedAt).toEqual(new Date("2026-04-24"));
		expect(root.aliases).toBeUndefined();
		expect(snapshot()).toMatchObject({
			name: "DeepSeek V4 Flash 0731",
			family: "deepseek",
			releasedAt: new Date("2026-07-31"),
		});
		expect(snapshot()?.aliases).toBeUndefined();
		expect(snapshot()?.output).toEqual(root.output);
		expect(snapshot()?.providers.map((mapping) => mapping.providerId)).toEqual(
			migrated,
		);
	});

	test.each(unchanged)(
		"moves %s metadata to the snapshot unchanged and retires it on the root",
		(providerId) => {
			const { deactivatedAt, ...metadata } = root.providers.find(
				(mapping) => mapping.providerId === providerId,
			)!;
			expect(deactivatedAt).toEqual(new Date("2026-11-06"));
			expect(
				snapshot()?.providers.find(
					(mapping) => mapping.providerId === providerId,
				),
			).toEqual(metadata);
		},
	);

	test("keeps the root only on deployments serving the original weights", () => {
		expect(live(root.providers)).toEqual(original);
		const mapping = (providerId: string) =>
			root.providers.find((m) => m.providerId === providerId);
		expect(mapping("deepinfra")?.externalId).toBe(
			"deepseek-ai/DeepSeek-V4-Flash",
		);
		expect(mapping("inference.net")?.externalId).toBe("deepseek-v4-flash");
		expect(
			snapshot()?.providers.find((m) => m.providerId === "deepinfra")
				?.externalId,
		).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
		expect(mapping("tencent")?.deactivatedAt).toEqual(new Date("2026-11-06"));
		expect(
			snapshot()?.providers.find((m) => m.providerId === "tencent")?.externalId,
		).toBe(mapping("tencent")?.externalId);
	});

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
		for (const [providerId, date] of [
			["deepseek", "2026-09-10"],
			["fireworks", "2026-10-19"],
			["together-ai", "2026-10-22"],
			["ranoai", "2026-11-06"],
			["canopywave", "2026-11-06"],
		] as const) {
			expect(
				root.providers.find((mapping) => mapping.providerId === providerId)
					?.deactivatedAt,
			).toEqual(new Date(date));
			expect(
				snapshot()?.providers.some(
					(mapping) => mapping.providerId === providerId,
				),
			).toBe(false);
		}
	});
});

describe("snapshot availability", () => {
	test("keeps all snapshot deployments and the full reference window", () => {
		const now = new Date("2026-11-15");
		const model = snapshot()!;
		expect(live(model.providers, now)).toEqual(migrated);
		expect(live(root.providers, now)).toEqual(original);
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
