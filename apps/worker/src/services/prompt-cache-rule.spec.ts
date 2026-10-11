import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
	findPromptCacheProblems,
	judgeDay,
	recoveryWindow,
	renderPromptCacheAlert,
	shouldSend,
	streamDays,
	type PromptCacheContext,
	type PromptCacheProblem,
	type PromptCacheStream,
	type SentAlert,
	type StreamCatalogue,
	type StreamHour,
} from "./prompt-cache-rule.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DAY0 = Date.UTC(2026, 7, 31);
const PACIFIC_OFFSET = 8 * HOUR;

function at(day: number, hour = 0): Date {
	const dayMs = day * DAY;
	const hourMs = hour * HOUR;
	return new Date(DAY0 + dayMs + hourMs);
}

interface Load {
	r: number;
	I: number;
	h: number;
	w: number;
	t: number;
	s: number;
}
type Workload = (day: number, hour: number) => Load | null;

interface Prices {
	input: number;
	cached: number;
	write: number;
}

interface Provider {
	id: string;
	name: string;
	catalogue: StreamCatalogue;
	billed: Prices;
}

const ANTHROPIC: Provider = {
	id: "anthropic",
	name: "Anthropic",
	catalogue: {
		inputPrice: new Decimal("0.000003"),
		cachedInputPrice: new Decimal("0.0000003"),
		minCacheableTokens: 1024,
		autoAddsMarkers: true,
		oneHourCaching: true,
	},
	billed: { input: 3e-6, cached: 0.3e-6, write: 3.75e-6 },
};

const OPENAI: Provider = {
	id: "openai",
	name: "OpenAI",
	catalogue: {
		inputPrice: new Decimal("0.00000125"),
		cachedInputPrice: new Decimal("0.000000125"),
		minCacheableTokens: 1024,
		autoAddsMarkers: false,
		oneHourCaching: false,
	},
	billed: { input: 1.25e-6, cached: 0.125e-6, write: 0 },
};

const CONTEXT: PromptCacheContext = {
	apiKeyId: "key-1",
	apiKeyDescription: "Production key",
	projectId: "project-1",
	organizationId: "org-1",
	organizationKind: "default",
	modelId: "example-model",
	cacheMode: "auto",
	autoTtl: "5m",
};

const AGENT = { r: 60, I: 60_000, t: 0.85, s: 1 };
const BATCH = { r: 200, I: 4000, t: 0, s: 0 };
const WARM = { h: 0.95, w: 0.04 };
const COLD = { h: 0.75, w: 0.2 };
const BROKEN = { h: 0.6, w: 0.05 };
const BLIP = { h: 0.3, w: 0.3 };

const isWorkday = (day: number, hour: number) =>
	day % 7 < 5 && hour >= 9 && hour <= 17;

const healthy = (hour: number) => (hour < 11 ? COLD : WARM);

function workday(
	shape: Omit<Load, "h" | "w">,
	cache: (day: number, hour: number) => { h: number; w: number },
	fromDay = 0,
): Workload {
	return (day, hour) =>
		day >= fromDay && isWorkday(day, hour)
			? { ...shape, ...cache(day, hour) }
			: null;
}

function row(hour: Date, load: Load, billed: Prices): StreamHour {
	const input = load.r * load.I;
	const cached = Math.round(load.h * input);
	const writes = Math.round(load.w * input);
	return {
		hour,
		requests: load.r,
		errors: 0,
		responseCacheReplays: 0,
		toolCalls: Math.round(load.t * load.r),
		streamed: Math.round(load.s * load.r),
		inputTokens: new Decimal(input),
		cachedTokens: new Decimal(cached),
		cacheWriteTokens: new Decimal(writes),
		uncachedTextInputCost: new Decimal(input - cached - writes).mul(
			billed.input,
		),
		cachedInputCost: new Decimal(cached).mul(billed.cached),
		cacheWriteInputCost: new Decimal(writes).mul(billed.write),
	};
}

function stream(
	workload: Workload,
	provider: Provider = ANTHROPIC,
	days = 42,
): PromptCacheStream {
	const hours: StreamHour[] = [];
	for (let day = 0; day < days; day++) {
		for (let hour = 0; hour < 24; hour++) {
			const load = workload(day, hour);
			if (load) {
				hours.push(row(at(day, hour), load, provider.billed));
			}
		}
	}
	return {
		providerId: provider.id,
		providerName: provider.name,
		region: null,
		catalogue: provider.catalogue,
		hours,
	};
}

interface Alert {
	at: Date;
	cause: string;
}

function runPasses(
	streams: PromptCacheStream[],
	{
		context = CONTEXT,
		from = at(14),
		to = at(42),
		step = HOUR,
	}: {
		context?: PromptCacheContext;
		from?: Date;
		to?: Date;
		step?: number;
	} = {},
): Alert[] {
	const sent: SentAlert[] = [];
	for (let t = from.getTime(); t < to.getTime(); t += step) {
		const windowEnd = new Date(t);
		const { problems } = findPromptCacheProblems(streams, context, windowEnd);
		const [problem] = problems
			.filter((p) => {
				const window = recoveryWindow(p, sent, windowEnd);
				const hours =
					streams.find((s) => s.providerId === p.stream.providerId)?.hours ??
					[];
				const recovery = window
					? streamDays(
							hours.filter(
								(h) => h.hour >= window.start && h.hour < window.end,
							),
							p.dayStartHour,
						)
					: [];
				return shouldSend(p, sent, recovery, windowEnd);
			})
			.sort((a, b) => b.estimatedDailyUsd.comparedTo(a.estimatedDailyUsd));
		if (problem) {
			sent.push({ at: windowEnd, cause: problem.cause });
		}
	}
	return sent;
}

function problemsAt(
	streams: PromptCacheStream[],
	windowEnd: Date,
	context = CONTEXT,
): PromptCacheProblem[] {
	return findPromptCacheProblems(streams, context, windowEnd).problems;
}

describe("findPromptCacheProblems and shouldSend", () => {
	it("stays silent on a healthy coding agent despite cold mornings", () => {
		expect(
			runPasses([stream(workday(AGENT, (_d, hour) => healthy(hour)))]),
		).toEqual([]);
	});

	it("tells a coding agent stuck at 60% once, on its second day", () => {
		const chronic = [stream(workday(AGENT, () => BROKEN, 14))];
		expect(runPasses(chronic)).toEqual([
			{ at: at(15, 12), cause: "cache_broken" },
		]);
		const [problem] = problemsAt(chronic, at(15, 12));
		expect({
			followUpShare: problem.followUpShare.toString(),
			hitRate: problem.hitRate.toString(),
			estimatedDailyUsd: problem.estimatedDailyUsd.toString(),
			reportedDayStart: problem.reportedDayStart,
		}).toEqual({
			followUpShare: "0.85",
			hitRate: "0.6",
			estimatedDailyUsd: "21.87",
			reportedDayStart: at(14, 1),
		});
	});

	it("stays silent on unique-prompt automation that cannot reuse a cache", () => {
		const unique = stream(() => ({ ...BATCH, I: 3000, h: 0.02, w: 0 }), OPENAI);
		expect(runPasses([unique])).toEqual([]);
	});

	it("tells unique prompts on Automatic that writes cost more than reads save, and leaves a shared system prompt alone", () => {
		const unique = stream(() => ({ ...BATCH, h: 0, w: 0.95 }));
		expect(runPasses([unique])).toEqual([
			{ at: at(14), cause: "writes_unused" },
		]);
		const sharedSystemPrompt = stream(() => ({ ...BATCH, h: 0.35, w: 0.6 }));
		expect(runPasses([sharedSystemPrompt])).toEqual([]);
	});

	it("advises Automatic to a Client-managed coding agent that sends no markers", () => {
		const unmarked = stream(
			workday({ ...AGENT, r: 40, I: 40_000 }, () => ({ h: 0, w: 0 }), 14),
		);
		expect(
			runPasses([unmarked], {
				context: { ...CONTEXT, cacheMode: "passthrough" },
			}),
		).toEqual([{ at: at(15, 11), cause: "switch_to_automatic" }]);
		expect(
			runPasses([unmarked], {
				context: {
					...CONTEXT,
					cacheMode: "passthrough",
					organizationKind: "devpass",
				},
			}),
			"DevPass org",
		).toEqual([]);
	});

	it("keeps a Pacific team's afternoon blip inside one day, not two UTC days", () => {
		const pacific = stream((day, hour) => {
			const local = at(day, hour).getTime() - PACIFIC_OFFSET;
			const localDay = Math.floor((local - DAY0) / DAY);
			const localHour = new Date(local).getUTCHours();
			if (!isWorkday(localDay, localHour)) {
				return null;
			}
			const blip = localDay === 30 && localHour >= 13 && localHour <= 16;
			return { ...AGENT, ...(blip ? BLIP : healthy(localHour)) };
		});
		expect(runPasses([pacific])).toEqual([]);
	});

	it("re-arms after a healthy day and alerts again once the 14-day gap opens", () => {
		const relapse = stream(
			workday(AGENT, (day) => (day >= 16 && day <= 18 ? WARM : BROKEN), 14),
		);
		expect(runPasses([relapse])).toEqual([
			{ at: at(15, 12), cause: "cache_broken" },
			{ at: at(29, 12), cause: "cache_broken" },
		]);
	});

	it("does not remind a chronic, unfixed key before 90 days", () => {
		const chronic = stream(
			workday(AGENT, () => BROKEN, 14),
			ANTHROPIC,
			110,
		);
		expect(
			runPasses([chronic], { from: at(14, 12), to: at(110), step: DAY }),
		).toEqual([
			{ at: at(15, 12), cause: "cache_broken" },
			{ at: at(105, 12), cause: "cache_broken" },
		]);
	});

	it("skips a light day with too little evidence when looking for the previous day", () => {
		const alternating = stream((day, hour) =>
			day >= 14 && hour >= 9 && hour <= 17
				? { ...AGENT, r: day % 2 === 0 ? 60 : 6, ...BROKEN }
				: null,
		);
		expect(runPasses([alternating])).toEqual([
			{ at: at(16, 12), cause: "cache_broken" },
		]);
	});

	it("prices with the billed rate, so long-context tiers and discounts do not flip writes_unused", () => {
		const haikuBase: Provider = {
			...ANTHROPIC,
			catalogue: {
				...ANTHROPIC.catalogue,
				inputPrice: new Decimal("0.0000001"),
				cachedInputPrice: new Decimal("0.00000001"),
				minCacheableTokens: 512,
			},
			billed: { input: 0.5e-6, cached: 0.05e-6, write: 0.625e-6 },
		};
		const tieredHealthy = stream(
			workday({ ...AGENT, r: 400, I: 150_000 }, (_d, hour) =>
				hour < 11 ? COLD : { h: 0.9, w: 0.08 },
			),
			haikuBase,
		);
		expect(runPasses([tieredHealthy]), "tiered healthy agent").toEqual([]);

		const discounted: Provider = {
			...ANTHROPIC,
			billed: { input: 2.4e-6, cached: 0.24e-6, write: 3e-6 },
		};
		const unique = stream(() => ({ ...BATCH, h: 0, w: 0.95 }), discounted);
		expect(runPasses([unique]), "unique prompts at a 20% discount").toEqual([
			{ at: at(14), cause: "writes_unused" },
		]);
	});

	it("judges each provider stream on its own numbers", () => {
		const anthropic = stream(workday(AGENT, () => BROKEN, 14));
		const openai = stream(
			workday(
				{ ...AGENT, r: 80, I: 50_000, t: 0.9 },
				() => ({ h: 0.3, w: 0 }),
				14,
			),
			OPENAI,
		);
		expect(
			problemsAt([anthropic, openai], at(15, 12)).map((p) => ({
				providerId: p.stream.providerId,
				hitRate: p.hitRate.toString(),
				estimatedDailyUsd: p.estimatedDailyUsd.toString(),
			})),
		).toEqual([
			{ providerId: "anthropic", hitRate: "0.6", estimatedDailyUsd: "21.87" },
			{ providerId: "openai", hitRate: "0.3", estimatedDailyUsd: "24.3" },
		]);
	});

	it("is silent when the project's effective mode is off", () => {
		const chronic = [stream(workday(AGENT, () => BROKEN, 14))];
		expect(
			runPasses(chronic, { context: { ...CONTEXT, cacheMode: "off" } }),
		).toEqual([]);
	});

	it("flags Automatic streams with no cache activity for ops, never for users", () => {
		const silent = [stream(workday(AGENT, () => ({ h: 0, w: 0 }), 14))];
		expect(findPromptCacheProblems(silent, CONTEXT, at(15, 12))).toMatchObject({
			problems: [],
			silentStreams: [{ providerId: "anthropic" }],
		});
		expect(runPasses(silent)).toEqual([]);
	});
});

describe("judgeDay", () => {
	function day(responseCacheReplays: number) {
		const hours = Array.from({ length: 9 }, (_, i) => ({
			...row(at(14, 9 + i), { ...AGENT, r: 100, ...WARM }, ANTHROPIC.billed),
			responseCacheReplays,
		}));
		const [only] = streamDays(hours, 1);
		return judgeDay(only, ANTHROPIC.catalogue, CONTEXT);
	}

	it("treats a day as unknown once response-cache replays pass 5% of requests", () => {
		expect(day(5).kind, "5%").toBe("healthy");
		expect(day(6).kind, "6%").toBe("unknown");
	});

	it("never judges a mapping without a cheaper cached price", () => {
		const [only] = streamDays(
			[row(at(14, 9), { ...AGENT, r: 100, ...BROKEN }, ANTHROPIC.billed)],
			0,
		);
		for (const cachedInputPrice of [null, new Decimal("0.000003")]) {
			expect(
				judgeDay(only, { ...ANTHROPIC.catalogue, cachedInputPrice }, CONTEXT),
			).toEqual({ kind: "unknown", automaticSilent: false });
		}
	});
});

describe("renderPromptCacheAlert", () => {
	const chronic = [stream(workday(AGENT, () => BROKEN, 14))];

	function render(
		streams: PromptCacheStream[],
		windowEnd: Date,
		context = CONTEXT,
	) {
		const [problem] = problemsAt(streams, windowEnd, context);
		return renderPromptCacheAlert(problem);
	}

	it("explains a broken cache with the 1-hour clause where Automatic 5m could use it", () => {
		expect(render(chronic, at(15, 12))).toEqual({
			title: "Prompt cache misses on example-model",
			message:
				"API key Production key, example-model via Anthropic: on its last full day of use, at least 85% of responses ended in streamed tool calls, yet only 60% of input tokens were read from the prompt cache. Today's traffic so far shows the same pattern. If those tool results go back with the conversation so far, check that instructions, tools and earlier messages keep an identical prefix. A change such as a timestamp makes the rest of the prompt a miss. If follow-ups are often more than 5 minutes apart, 1-hour caching keeps the prefix warm. A stable prefix could save an estimated $21.87 a day, less if each turn adds a large new tool result.",
			href: "/features/caching/provider-cache-control",
		});
		const oneHour = render(chronic, at(15, 12), { ...CONTEXT, autoTtl: "1h" });
		expect(oneHour.message, "already on 1-hour caching").not.toContain(
			"1-hour caching",
		);
	});

	it("asks Client-managed projects to mark the latest message", () => {
		expect(
			render(chronic, at(15, 12), { ...CONTEXT, cacheMode: "passthrough" })
				.message,
		).toContain(
			"A change such as a timestamp makes the rest of the prompt a miss. With Client-managed caching the cache also ends at your last marker, so mark the latest message too, or switch the project to Automatic. A stable prefix",
		);
	});

	it("advises Automatic to an unmarked Client-managed project, linking its settings", () => {
		const unmarked = [
			stream(
				workday({ ...AGENT, r: 40, I: 40_000 }, () => ({ h: 0, w: 0 }), 14),
			),
		];
		expect(
			render(unmarked, at(15, 11), { ...CONTEXT, cacheMode: "passthrough" }),
		).toEqual({
			title: "Prompt cache unused on example-model",
			message:
				"API key Production key, example-model via Anthropic: on its last full day of use, at least 85% of responses ended in streamed tool calls, yet the provider reported no prompt-cache reads or writes. Today's traffic so far shows the same pattern. This project uses Client-managed caching and these requests carry no cache markers. If tool results go back with the same conversation, add cache markers or switch the project to Automatic, which could save an estimated $33.05 a day. One-off prompts pay a cache-write premium under Automatic.",
			href: "/dashboard/org-1/project-1/settings/preferences",
		});
	});

	it("offers 5-minute caching before caching off when 1-hour writes cost more than reads save", () => {
		const unique = [stream(() => ({ ...BATCH, h: 0, w: 0.95 }))];
		expect(render(unique, at(14))).toEqual({
			title: "Prompt cache costs more than it saves on example-model",
			message:
				"API key Production key, example-model via Anthropic: on its last full day of use, Automatic caching paid $13.68 in cache-write premiums and saved $0.00 on cache reads, a net extra cost of $13.68. Today's traffic so far shows the same pattern. If this key sends one-off prompts, move that workload to a project with caching off. Keep reusable conversations on a project with caching enabled.",
			href: "/dashboard/org-1/project-1/settings/preferences",
		});
		expect(
			render(unique, at(14), { ...CONTEXT, autoTtl: "1h" }).message,
		).toContain(
			"Today's traffic so far shows the same pattern. If follow-ups usually arrive within 5 minutes, switch the project to 5-minute caching, whose writes cost less. If this key sends one-off prompts, move that workload to a project with caching off.",
		);
	});

	it("names the region only when the key and model run in more than one", () => {
		const eu = { ...stream(workday(AGENT, () => BROKEN, 14)), region: "eu" };
		const us = {
			...stream(workday({ ...AGENT, r: 6 }, () => WARM, 14)),
			region: "us",
		};
		expect(render([eu, us], at(15, 12)).message).toContain(
			"example-model via Anthropic (eu): on its last full day",
		);
		expect(render([eu], at(15, 12)).message).toContain(
			"example-model via Anthropic: on its last full day",
		);
	});
});
