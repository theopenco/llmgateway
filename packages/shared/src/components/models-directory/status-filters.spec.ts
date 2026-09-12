import { describe, expect, test } from "vitest";

import { getMappingStatus, isMappingDeactivated } from "@/deactivation.js";

import { isVisibleMapping } from "./status-filters";

import type { ApiModel, ApiModelProviderMapping } from "./api-types";

const NOW = new Date("2026-08-25T00:00:00.000Z");

const DAY_MS = 24 * 60 * 60 * 1000;

const daysFromNow = (days: number): string => {
	const offset = days * DAY_MS;
	return new Date(NOW.getTime() + offset).toISOString();
};

function makeMapping(
	overrides: Partial<ApiModelProviderMapping> & { providerId: string },
): ApiModelProviderMapping {
	return {
		id: `mapping-${overrides.providerId}`,
		createdAt: "2026-01-01T00:00:00.000Z",
		modelId: "mock-model",
		externalId: "mock-model",
		region: null,
		inputPrice: "1e-6",
		outputPrice: "3e-6",
		cachedInputPrice: null,
		cacheWriteInputPrice: null,
		cacheWriteInputPrice1h: null,
		imageInputPrice: null,
		imageOutputPrice: null,
		imageInputTokensByResolution: null,
		imageOutputTokensByResolution: null,
		inputCharacterPrice: null,
		outputAudioPrice: null,
		requestPrice: null,
		contextSize: 128000,
		maxOutput: 8192,
		streaming: true,
		vision: false,
		reasoning: false,
		reasoningOutput: null,
		reasoningMaxTokens: false,
		rerank: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		webSearch: false,
		webSearchPrice: null,
		quantization: null,
		supportedVideoSizes: null,
		supportedVideoDurationsSeconds: null,
		supportsVideoAudio: null,
		supportsVideoWithoutAudio: null,
		perSecondPrice: null,
		perImagePrice: null,
		pricingTiers: null,
		discount: null,
		stability: "stable",
		supportedParameters: null,
		deprecatedAt: null,
		deactivatedAt: null,
		status: "active",
		...overrides,
	};
}

function makeModel(id: string, mappings: ApiModelProviderMapping[]): ApiModel {
	return {
		id,
		createdAt: "2026-01-01T00:00:00.000Z",
		releasedAt: null,
		name: id,
		aliases: null,
		description: null,
		family: "mock",
		free: false,
		output: ["text"],
		premium: false,
		stability: "stable",
		status: "active",
		mappings,
	};
}

interface VisibilityOptions {
	showDeactivated: boolean;
	eligibleOnly?: boolean;
}

/**
 * Golden reference of the directory's current mapping-visibility rules
 * (all-models.tsx visibleMappings + zero-mapping model drop). Phase 0 pins
 * this behavior so the status-chip pipeline must reproduce it when no status
 * is selected.
 */
function todayVisibleMappings(
	mappings: ApiModelProviderMapping[],
	{ showDeactivated, eligibleOnly }: VisibilityOptions,
	now: Date = NOW,
): ApiModelProviderMapping[] {
	return mappings.filter((mapping) => {
		if (mapping.deprecatedAt && new Date(mapping.deprecatedAt) <= now) {
			return false;
		}
		if (!showDeactivated && isMappingDeactivated(mapping, now)) {
			return false;
		}
		if (eligibleOnly && mapping.blockedReasons?.length) {
			return false;
		}
		return true;
	});
}

function todayVisibleModels(
	models: ApiModel[],
	options: VisibilityOptions,
	now: Date = NOW,
): ApiModel[] {
	return models
		.map((model) => ({
			...model,
			mappings: todayVisibleMappings(model.mappings, options, now),
		}))
		.filter((model) => model.mappings.length > 0);
}

const healthy = makeMapping({ providerId: "healthy" });
const scheduledSoon = makeMapping({
	providerId: "scheduled-soon",
	deactivatedAt: daysFromNow(89),
});
const scheduledFar = makeMapping({
	providerId: "scheduled-far",
	deactivatedAt: daysFromNow(91),
});
const deactivated = makeMapping({
	providerId: "deactivated",
	deactivatedAt: daysFromNow(-1),
});
const deactivatedBoundary = makeMapping({
	providerId: "deactivated-boundary",
	deactivatedAt: NOW.toISOString(),
});
const deprecatedPast = makeMapping({
	providerId: "deprecated-past",
	deprecatedAt: daysFromNow(-1),
});
const deprecatedFuture = makeMapping({
	providerId: "deprecated-future",
	deprecatedAt: daysFromNow(30),
});
const deprecatedThenScheduled = makeMapping({
	providerId: "deprecated-then-scheduled",
	deprecatedAt: daysFromNow(-2),
	deactivatedAt: daysFromNow(10),
});

describe("today's mapping visibility rules (phase 0 baseline)", () => {
	test("default hides past-deactivated and past-deprecated mappings", () => {
		const visible = todayVisibleMappings(
			[healthy, deactivated, deprecatedPast],
			{ showDeactivated: false },
		);
		expect(visible.map((m) => m.providerId)).toEqual(["healthy"]);
	});

	test("scheduled mappings stay visible regardless of the notice window", () => {
		const visible = todayVisibleMappings(
			[healthy, scheduledSoon, scheduledFar],
			{ showDeactivated: false },
		);
		expect(visible.map((m) => m.providerId)).toEqual([
			"healthy",
			"scheduled-soon",
			"scheduled-far",
		]);
	});

	test("show deactivated reveals past-deactivated mappings", () => {
		const visible = todayVisibleMappings([healthy, deactivated], {
			showDeactivated: true,
		});
		expect(visible.map((m) => m.providerId)).toEqual([
			"healthy",
			"deactivated",
		]);
	});

	test("past-deprecated mappings stay hidden even with show deactivated", () => {
		const visible = todayVisibleMappings([healthy, deprecatedPast], {
			showDeactivated: true,
		});
		expect(visible.map((m) => m.providerId)).toEqual(["healthy"]);
	});

	test("future-deprecated mappings stay visible", () => {
		const visible = todayVisibleMappings([healthy, deprecatedFuture], {
			showDeactivated: false,
		});
		expect(visible.map((m) => m.providerId)).toEqual([
			"healthy",
			"deprecated-future",
		]);
	});

	test("a mapping deprecated in the past is dropped even if deactivation is only scheduled", () => {
		const visible = todayVisibleMappings([deprecatedThenScheduled], {
			showDeactivated: true,
		});
		expect(visible).toEqual([]);
	});

	test("deactivation boundary is inclusive: deactivatedAt === now is hidden", () => {
		const visible = todayVisibleMappings([deactivatedBoundary], {
			showDeactivated: false,
		});
		expect(visible).toEqual([]);
		expect(
			todayVisibleMappings([deactivatedBoundary], { showDeactivated: true }),
		).toHaveLength(1);
	});

	test("eligibleOnly drops blocked mappings", () => {
		const blocked = makeMapping({
			providerId: "blocked",
			blockedReasons: ["compliance"],
		});
		const visible = todayVisibleMappings([healthy, blocked], {
			showDeactivated: false,
			eligibleOnly: true,
		});
		expect(visible.map((m) => m.providerId)).toEqual(["healthy"]);
	});
});

describe("getMappingStatus classification of the baseline fixtures", () => {
	test("classifies each phase-0 fixture exactly once", () => {
		expect(getMappingStatus(healthy, NOW)).toBe("active");
		expect(getMappingStatus(scheduledSoon, NOW)).toBe("scheduled");
		// 91 days out is beyond the directory's 90-day notice window.
		expect(getMappingStatus(scheduledFar, NOW)).toBe("active");
		expect(getMappingStatus(deactivated, NOW)).toBe("deactivated");
		expect(getMappingStatus(deactivatedBoundary, NOW)).toBe("deactivated");
		expect(getMappingStatus(deprecatedPast, NOW)).toBe("deprecated");
		expect(getMappingStatus(deprecatedFuture, NOW)).toBe("deprecated");
		expect(getMappingStatus(deprecatedThenScheduled, NOW)).toBe("scheduled");
	});
});

describe("isVisibleMapping (phase 3 pipeline)", () => {
	const options = (
		overrides: Partial<{
			status: "active" | "scheduled" | "deprecated" | "deactivated" | null;
			showDeactivated: boolean;
			eligibleOnly: boolean;
		}> = {},
	) => ({
		status: null,
		showDeactivated: false,
		...overrides,
	});

	test("null status reproduces the phase-0 default rules exactly", () => {
		const all = [
			healthy,
			scheduledSoon,
			scheduledFar,
			deactivated,
			deactivatedBoundary,
			deprecatedPast,
			deprecatedFuture,
			deprecatedThenScheduled,
		];
		expect(all.filter((m) => isVisibleMapping(m, options(), NOW))).toEqual(
			todayVisibleMappings(all, { showDeactivated: false }),
		);
	});

	test("null status with legacy show deactivated reproduces the unhide rules", () => {
		const all = [healthy, deactivated, deprecatedPast, deprecatedThenScheduled];
		expect(
			all.filter((m) =>
				isVisibleMapping(m, options({ showDeactivated: true }), NOW),
			),
		).toEqual(todayVisibleMappings(all, { showDeactivated: true }));
	});

	test("legacy show deactivated overrides a selected status", () => {
		expect(
			isVisibleMapping(
				healthy,
				options({ status: "deactivated", showDeactivated: true }),
				NOW,
			),
		).toBe(true);
		expect(
			isVisibleMapping(
				deprecatedPast,
				options({ status: "deactivated", showDeactivated: true }),
				NOW,
			),
		).toBe(false);
	});

	test("deactivated chip keeps only past-deactivated mappings", () => {
		const all = [healthy, scheduledSoon, deactivated, deprecatedPast];
		expect(
			all
				.filter((m) =>
					isVisibleMapping(m, options({ status: "deactivated" }), NOW),
				)
				.map((m) => m.providerId),
		).toEqual(["deactivated"]);
	});

	test("scheduled chip keeps only in-window scheduled mappings", () => {
		const all = [healthy, scheduledSoon, scheduledFar, deactivated];
		expect(
			all
				.filter((m) =>
					isVisibleMapping(m, options({ status: "scheduled" }), NOW),
				)
				.map((m) => m.providerId),
		).toEqual(["scheduled-soon"]);
	});

	test("deprecated chip reveals past-deprecated mappings", () => {
		const all = [healthy, deprecatedPast, deprecatedFuture, deactivated];
		expect(
			all
				.filter((m) =>
					isVisibleMapping(m, options({ status: "deprecated" }), NOW),
				)
				.map((m) => m.providerId),
		).toEqual(["deprecated-past", "deprecated-future"]);
	});

	test("active chip keeps strictly healthy mappings only", () => {
		const all = [
			healthy,
			scheduledSoon,
			scheduledFar,
			deactivated,
			deprecatedFuture,
		];
		expect(
			all
				.filter((m) => isVisibleMapping(m, options({ status: "active" }), NOW))
				.map((m) => m.providerId),
		).toEqual(["healthy", "scheduled-far"]);
	});

	test("eligibleOnly composes inside a selected status", () => {
		const blockedDead = makeMapping({
			providerId: "blocked-dead",
			deactivatedAt: daysFromNow(-1),
			blockedReasons: ["compliance"],
		});
		expect(
			isVisibleMapping(
				blockedDead,
				options({ status: "deactivated", eligibleOnly: true }),
				NOW,
			),
		).toBe(false);
		expect(
			isVisibleMapping(blockedDead, options({ status: "deactivated" }), NOW),
		).toBe(true);
	});
});

describe("today's model visibility rules (phase 0 baseline)", () => {
	test("a fully deactivated model is dropped by default and restored by the toggle", () => {
		const dead = makeModel("dead-model", [
			makeMapping({ providerId: "a", deactivatedAt: daysFromNow(-5) }),
			makeMapping({ providerId: "b", deactivatedAt: daysFromNow(-2) }),
		]);
		expect(todayVisibleModels([dead], { showDeactivated: false })).toEqual([]);
		const shown = todayVisibleModels([dead], { showDeactivated: true });
		expect(shown).toHaveLength(1);
		expect(shown[0].mappings).toHaveLength(2);
	});

	test("a mixed model keeps only its live mappings by default", () => {
		const mixed = makeModel("mixed-model", [
			healthy,
			makeMapping({ providerId: "dead", deactivatedAt: daysFromNow(-3) }),
		]);
		const byDefault = todayVisibleModels([mixed], {
			showDeactivated: false,
		});
		expect(byDefault).toHaveLength(1);
		expect(byDefault[0].mappings.map((m) => m.providerId)).toEqual(["healthy"]);

		const revealed = todayVisibleModels([mixed], { showDeactivated: true });
		expect(revealed[0].mappings).toHaveLength(2);
	});

	test("counting predicate agrees with the visible set", () => {
		const models = [
			makeModel("healthy-model", [healthy]),
			makeModel("mixed-model", [
				healthy,
				makeMapping({ providerId: "dead", deactivatedAt: daysFromNow(-3) }),
			]),
			makeModel("dead-model", [
				makeMapping({ providerId: "a", deactivatedAt: daysFromNow(-5) }),
			]),
		];
		// Mirrors the totalModelCount predicate (all-models.tsx :930-937).
		const counted = models.filter((model) =>
			model.mappings.some((mapping) => {
				if (mapping.deprecatedAt && new Date(mapping.deprecatedAt) <= NOW) {
					return false;
				}
				return !isMappingDeactivated(mapping, NOW);
			}),
		).length;
		expect(counted).toBe(
			todayVisibleModels(models, { showDeactivated: false }).length,
		);
		expect(counted).toBe(2);
	});
});
