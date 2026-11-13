import { Decimal } from "decimal.js";

import {
	isLiveMapping,
	models,
	providers,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { calculateFees } from "@llmgateway/shared";

export const COLUMN_ROLES = [
	"model",
	"inputTokens",
	"outputTokens",
	"cachedTokens",
	"cost",
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];
export type ColumnMapping = Partial<Record<ColumnRole, string>>;

export const REQUIRED_ROLES: readonly ColumnRole[] = [
	"model",
	"inputTokens",
	"outputTokens",
];

export const ROLE_LABELS: Record<ColumnRole, string> = {
	model: "Model",
	inputTokens: "Input tokens",
	outputTokens: "Output tokens",
	cachedTokens: "Cached input tokens",
	cost: "Cost (USD)",
};

// Header names used by common usage exports, most specific first.
const COLUMN_ALIASES: Record<ColumnRole, string[]> = {
	model: ["model_permaslug", "model_slug", "model_id", "model_name", "model"],
	inputTokens: [
		"tokens_prompt",
		"prompt_tokens",
		"input_tokens",
		"n_context_tokens_total",
		"native_tokens_prompt",
	],
	outputTokens: [
		"tokens_completion",
		"completion_tokens",
		"output_tokens",
		"n_generated_tokens_total",
		"native_tokens_completion",
	],
	cachedTokens: [
		"tokens_cached",
		"cached_tokens",
		"input_cached_tokens",
		"cache_read_input_tokens",
		"native_tokens_cached",
	],
	cost: ["cost_total", "total_cost", "cost_usd", "amount_usd", "cost"],
};

function normalizeHeader(header: string): string {
	return header
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

/** Guess which CSV column plays each role from its header name. */
export function detectColumns(headers: string[]): ColumnMapping {
	const byNormalized = new Map<string, string>();
	for (const header of headers) {
		const key = normalizeHeader(header);
		if (!byNormalized.has(key)) {
			byNormalized.set(key, header);
		}
	}
	const mapping: ColumnMapping = {};
	for (const role of COLUMN_ROLES) {
		const alias = COLUMN_ALIASES[role].find((name) => byNormalized.has(name));
		if (alias) {
			mapping[role] = byNormalized.get(alias);
		}
	}
	return mapping;
}

export function missingRoles(mapping: ColumnMapping): ColumnRole[] {
	return REQUIRED_ROLES.filter((role) => !mapping[role]);
}

const catalogue = models as readonly ModelDefinition[];
const modelLookup = new Map<string, ModelDefinition>();
for (const model of catalogue) {
	if (model.family === "llmgateway") {
		continue;
	}
	for (const key of [model.id, ...(model.aliases ?? [])]) {
		const normalized = key.toLowerCase();
		if (!modelLookup.has(normalized)) {
			modelLookup.set(normalized, model);
		}
	}
}
const providerNames = new Map<string, string>(
	providers.map((provider) => [provider.id, provider.name]),
);

/**
 * Resolve a model name from another platform's export to a catalogue model.
 * Handles vendor prefixes ("openai/gpt-x"), variant suffixes (":free"), dated
 * snapshots ("-2025-01-31", "-20250131") and dotted versions ("3.5" → "3-5").
 */
export function matchModel(name: string): ModelDefinition | undefined {
	const base = name.trim().toLowerCase().split("/").pop()?.split(":")[0] ?? "";
	if (!base) {
		return undefined;
	}
	const undated = base
		.replace(/-\d{4}-\d{2}-\d{2}$/, "")
		.replace(/-\d{8}$/, "")
		.replace(/-latest$/, "");
	const candidates = [
		base,
		undated,
		base.replace(/\./g, "-"),
		undated.replace(/\./g, "-"),
	];
	for (const candidate of candidates) {
		const model = modelLookup.get(candidate);
		if (model) {
			return model;
		}
	}
	return undefined;
}

export interface TokenMix {
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
}

function hasPrices(mapping: ProviderModelMapping): boolean {
	return mapping.inputPrice !== undefined && mapping.outputPrice !== undefined;
}

/**
 * Token cost of a mix on one mapping. Exports report cached tokens as part of
 * the input count, so they are billed at the cached rate and removed from the
 * full-price input.
 */
export function mappingCost(
	mapping: ProviderModelMapping,
	mix: TokenMix,
): Decimal {
	const inputPrice = new Decimal(mapping.inputPrice ?? 0);
	const cachedPrice = new Decimal(mapping.cachedInputPrice ?? inputPrice);
	const cached = Math.min(mix.cachedTokens, mix.inputTokens);
	return inputPrice
		.mul(mix.inputTokens - cached)
		.plus(cachedPrice.mul(cached))
		.plus(new Decimal(mapping.outputPrice ?? 0).mul(mix.outputTokens));
}

function cheapestMapping(
	model: ModelDefinition,
	mix: TokenMix,
	now: Date,
): { mapping: ProviderModelMapping; cost: Decimal } | null {
	let best: { mapping: ProviderModelMapping; cost: Decimal } | null = null;
	for (const mapping of model.providers) {
		if (!hasPrices(mapping) || !isLiveMapping(mapping, now)) {
			continue;
		}
		const cost = mappingCost(mapping, mix);
		if (!best || cost.lt(best.cost)) {
			best = { mapping, cost };
		}
	}
	return best;
}

/** The model lab's own list price, used when the export has no cost column. */
function listPrice(model: ModelDefinition, mix: TokenMix): Decimal | null {
	const official =
		model.providers.find((mapping) => mapping.providerId === model.family) ??
		model.providers[0];
	return official && hasPrices(official) ? mappingCost(official, mix) : null;
}

// The platform fee on credits, read from the billing code rather than restated.
const FEE_PROBE_AMOUNT = 100;
export const PLATFORM_FEE_RATE = new Decimal(
	calculateFees({ amount: FEE_PROBE_AMOUNT }).platformFee,
).div(FEE_PROBE_AMOUNT);

function toCount(value: unknown): number {
	const parsed = Number(String(value ?? "").replace(/,/g, ""));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toMoney(value: unknown): Decimal | null {
	const cleaned = String(value ?? "")
		.replace(/[$,\s]/g, "")
		.trim();
	if (cleaned === "") {
		return null;
	}
	try {
		const amount = new Decimal(cleaned);
		return amount.isFinite() ? amount : null;
	} catch {
		// decimal.js throws on text that is not a number: treat as "no cost".
		return null;
	}
}

interface Bucket extends TokenMix {
	requests: number;
	cost: Decimal;
}

/** Streams CSV rows into per-model totals, so large exports stay cheap. */
export class UsageAggregator {
	private readonly buckets = new Map<string, Bucket>();
	public rowCount = 0;

	public constructor(private readonly mapping: ColumnMapping) {}

	public add(row: Record<string, unknown>): void {
		const { model, inputTokens, outputTokens, cachedTokens, cost } =
			this.mapping;
		const name = model ? String(row[model] ?? "").trim() : "";
		if (!name) {
			return;
		}
		this.rowCount += 1;
		const bucket = this.buckets.get(name) ?? {
			requests: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedTokens: 0,
			cost: new Decimal(0),
		};
		bucket.requests += 1;
		bucket.inputTokens += inputTokens ? toCount(row[inputTokens]) : 0;
		bucket.outputTokens += outputTokens ? toCount(row[outputTokens]) : 0;
		bucket.cachedTokens += cachedTokens ? toCount(row[cachedTokens]) : 0;
		const amount = cost ? toMoney(row[cost]) : null;
		if (amount) {
			bucket.cost = bucket.cost.plus(amount);
		}
		this.buckets.set(name, bucket);
	}

	public result(now: Date = new Date()): AuditResult {
		return buildAudit(this.buckets, Boolean(this.mapping.cost), now);
	}
}

export interface AuditRow extends TokenMix {
	sourceModel: string;
	rows: number;
	modelId: string | null;
	modelName: string | null;
	providerName: string | null;
	/** What this usage cost before: from the file, or the lab's list price. */
	baseline: Decimal | null;
	/** Provider cost on LLM Gateway, before the platform fee. */
	gateway: Decimal | null;
}

export interface AuditResult {
	/** "file" when the export carries costs, "list" when list prices stand in. */
	baselineSource: "file" | "list";
	rows: AuditRow[];
	unmatched: string[];
	comparedRows: number;
	totals: {
		baseline: Decimal;
		gatewayUsage: Decimal;
		platformFee: Decimal;
		gateway: Decimal;
		difference: Decimal;
		differencePercent: Decimal | null;
	};
}

function buildAudit(
	buckets: Map<string, Bucket>,
	hasCostColumn: boolean,
	now: Date,
): AuditResult {
	const rows: AuditRow[] = [];
	const unmatched: string[] = [];
	let baselineTotal = new Decimal(0);
	let usageTotal = new Decimal(0);
	let comparedRows = 0;

	for (const [sourceModel, bucket] of Array.from(buckets)) {
		const model = matchModel(sourceModel);
		const cheapest = model ? cheapestMapping(model, bucket, now) : null;
		const baseline = hasCostColumn
			? bucket.cost
			: model
				? listPrice(model, bucket)
				: null;
		const comparable = cheapest !== null && baseline !== null;
		if (comparable) {
			baselineTotal = baselineTotal.plus(baseline);
			usageTotal = usageTotal.plus(cheapest.cost);
			comparedRows += bucket.requests;
		} else {
			unmatched.push(sourceModel);
		}
		rows.push({
			sourceModel,
			rows: bucket.requests,
			inputTokens: bucket.inputTokens,
			outputTokens: bucket.outputTokens,
			cachedTokens: bucket.cachedTokens,
			modelId: model?.id ?? null,
			modelName: model ? (model.name ?? model.id) : null,
			providerName: cheapest
				? (providerNames.get(cheapest.mapping.providerId) ??
					cheapest.mapping.providerId)
				: null,
			baseline: comparable ? baseline : null,
			gateway: comparable ? cheapest.cost : null,
		});
	}

	rows.sort((a, b) => {
		const left = a.baseline ?? new Decimal(-1);
		const right = b.baseline ?? new Decimal(-1);
		return right.cmp(left) || b.rows - a.rows;
	});

	const platformFee = usageTotal.mul(PLATFORM_FEE_RATE);
	const gateway = usageTotal.plus(platformFee);
	const difference = baselineTotal.minus(gateway);
	return {
		baselineSource: hasCostColumn ? "file" : "list",
		rows,
		unmatched: unmatched.sort(),
		comparedRows,
		totals: {
			baseline: baselineTotal,
			gatewayUsage: usageTotal,
			platformFee,
			gateway,
			difference,
			differencePercent: baselineTotal.gt(0)
				? difference.div(baselineTotal).mul(100)
				: null,
		},
	};
}

/** USD with enough digits that small audits do not read as $0.00. */
export function formatAuditUsd(amount: Decimal): string {
	const abs = amount.abs();
	const digits = abs.gt(0) && abs.lt(1) ? 4 : 2;
	const formatted = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: digits,
	}).format(abs.toNumber());
	return amount.isNegative() ? `-${formatted}` : formatted;
}

const SAMPLE_HEADER =
	"created_at,model,tokens_prompt,tokens_completion,tokens_cached";
const SAMPLE_MODELS = 4;
const SAMPLE_PROBE: TokenMix = {
	inputTokens: 1_000_000,
	outputTokens: 1_000_000,
	cachedTokens: 0,
};
const SAMPLE_ROWS = [
	{
		day: "03",
		inputTokens: 42_000_000,
		outputTokens: 6_500_000,
		cachedTokens: 12_000_000,
	},
	{
		day: "11",
		inputTokens: 18_000_000,
		outputTokens: 9_000_000,
		cachedTokens: 0,
	},
	{
		day: "19",
		inputTokens: 64_000_000,
		outputTokens: 4_000_000,
		cachedTokens: 30_000_000,
	},
	{
		day: "27",
		inputTokens: 9_000_000,
		outputTokens: 2_500_000,
		cachedTokens: 0,
	},
];

/**
 * A small token-only export. It is built from the catalogue, so it never names
 * a dropped model, and uses the models whose providers differ most in price,
 * which is where routing changes the bill.
 */
export function sampleCsv(now: Date = new Date()): string {
	const multiProvider = catalogue
		.flatMap((model) => {
			if (model.family === "llmgateway") {
				return [];
			}
			const list = listPrice(model, SAMPLE_PROBE);
			const cheapest = cheapestMapping(model, SAMPLE_PROBE, now);
			return list && cheapest && list.gt(0)
				? [{ model, ratio: cheapest.cost.div(list).toNumber() }]
				: [];
		})
		.sort((a, b) => a.ratio - b.ratio)
		.slice(0, SAMPLE_MODELS)
		.map((entry) => entry.model);
	const lines = [SAMPLE_HEADER];
	multiProvider.forEach((model, index) => {
		const usage = SAMPLE_ROWS[index % SAMPLE_ROWS.length];
		lines.push(
			[
				`2026-01-${usage.day}`,
				`${model.family}/${model.id}`,
				usage.inputTokens,
				usage.outputTokens,
				usage.cachedTokens,
			].join(","),
		);
	});
	return lines.join("\n");
}
