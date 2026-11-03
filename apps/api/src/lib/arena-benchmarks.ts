import { parquetReadObjects } from "hyparquet";

import { logger } from "@llmgateway/logger";

/**
 * Arena benchmark data fetcher with caching.
 *
 * arena.ai answers server-side requests with a Cloudflare challenge (HTTP 403),
 * so ratings come from the official `lmarena-ai/leaderboard-dataset` snapshots
 * on the Hugging Face datasets CDN. Text ratings use the style-controlled
 * leaderboard (Arena's default since May 2025); code ratings use Code Arena.
 */

interface ArenaEntry {
	rank: number;
	model: string;
	score: number;
}

interface ArenaBenchmarks {
	text: ArenaEntry[];
	code: ArenaEntry[];
	fetchedAt: string;
}

interface ArenaSnapshot {
	entries: ArenaEntry[];
	publishedAt: string | null;
}

interface ArenaCandidate {
	entry: ArenaEntry;
	tokens: string[];
}

const DATASET_URL =
	"https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset";
const DATASET_REVISION = "main";
const SUBSETS = { text: "text_style_control", code: "webdev" } as const;

let cachedData: ArenaBenchmarks | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETRY_MS = 5 * 60 * 1000;

/**
 * Words Arena adds for an effort level, thinking mode or rollout of the same
 * model, so `gemini-3-pro` still matches `Gemini 3 Pro Preview`.
 */
const QUALIFIER_TOKENS = new Set([
	"preview",
	"latest",
	"exp",
	"experimental",
	"thinking",
	"reasoning",
	"high",
	"xhigh",
	"medium",
	"low",
	"instant",
	"fast",
	"turbo",
	"max",
	// `gemma-4-31b-it` against `gemma-4-31b`, `claude-haiku-4-5-free` against
	// `claude-haiku-4-5-20251001`.
	"it",
	"free",
]);

/**
 * Words that name a *different* model and must never be discounted: `gpt-5` is
 * not `gpt-5-codex`, `gpt-4.1` is not `gpt-4.1-mini`.
 */
const DISTINCT_TOKENS = new Set([
	"mini",
	"nano",
	"micro",
	"lite",
	"small",
	"codex",
	"code",
	"pro",
	"flash",
	"plus",
	"opus",
	"sonnet",
	"haiku",
	"instruct",
	"chat",
	"vision",
	"image",
	"audio",
	"realtime",
	"transcribe",
	"embedding",
	"rerank",
	"search",
]);

/** Splits a model name into lowercase word tokens, dropping qualifiers. */
function modelTokens(name: string): string[] {
	return name
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** Only qualifiers and release dates may be discounted between two names. */
function isDiscountableToken(token: string): boolean {
	return QUALIFIER_TOKENS.has(token) || /^[0-9]{2,}$/.test(token);
}

function equalTokens(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((token, index) => token === b[index]);
}

function startsWithTokens(tokens: string[], prefix: string[]): boolean {
	return prefix.every((token, index) => tokens[index] === token);
}

function sharedPrefix(a: string[], b: string[]): number {
	let index = 0;
	while (index < a.length && index < b.length && a[index] === b[index]) {
		index++;
	}
	return index;
}

/** Arena sometimes publishes both a plain and a `(High)`-style entry. */
function qualificationRank(entry: ArenaEntry): number {
	return entry.model.includes("(") ? 1 : 0;
}

function best(
	matches: ArenaCandidate[],
	compare: (a: ArenaCandidate, b: ArenaCandidate) => number,
): ArenaEntry {
	return [...matches].sort(
		(a, b) =>
			qualificationRank(a.entry) - qualificationRank(b.entry) || compare(a, b),
	)[0]!.entry;
}

/**
 * Maps a model ID from our system to possible Arena leaderboard names.
 * Arena uses different naming conventions, so we need fuzzy matching.
 */
export function findArenaMatch(
	modelId: string,
	entries: ArenaEntry[],
): ArenaEntry | null {
	const id = modelId.toLowerCase();

	// Common mappings between our model IDs and Arena names
	const mappings: Record<string, string[]> = {
		// Claude models
		"claude-sonnet-4-6-20250520": [
			"claude-sonnet-4-6",
			"claude-sonnet-4-6-20250520",
		],
		"claude-opus-4-6-20250605": ["claude-opus-4-6", "claude-opus-4-6-20250605"],
		"claude-opus-4-5-20251101": ["claude-opus-4-5-20251101"],
		"claude-sonnet-4-5-20250929": ["claude-sonnet-4-5-20250929"],
		"claude-haiku-4-5-20251001": ["claude-haiku-4-5-20251001"],
		"claude-opus-4-20250514": ["claude-opus-4-20250514"],
		"claude-sonnet-4-20250514": [
			"claude-sonnet-4-20250514",
			"claude-sonnet-4-20250514-thinking-32k",
		],
		"claude-3-5-sonnet-20241022": [
			"claude-3-5-sonnet-20241022",
			"claude-3.5-sonnet-20241022",
		],
		"claude-3-5-haiku-20241022": [
			"claude-3-5-haiku-20241022",
			"claude-3.5-haiku-20241022",
		],
		"claude-3-opus-20240229": ["claude-3-opus-20240229"],
		// GPT models
		"gpt-5-chat-latest": ["gpt-5-chat", "gpt-5.3-chat-latest", "gpt-5-chat"],
		"gpt-4o": ["chatgpt-4o-latest-20250326", "gpt-4o-2024-11-20"],
		"gpt-4o-mini": ["gpt-4o-mini-2024-07-18"],
		"gpt-4-turbo": ["gpt-4-turbo-2024-04-09"],
		// Gemini models
		"gemini-2.0-flash": ["gemini-2.0-flash-001"],
		// DeepSeek models
		"deepseek-r1": ["deepseek-r1", "deepseek-r1-0528"],
		"deepseek-v3": ["deepseek-v3-0324", "deepseek-v3"],
		// Mistral models
		"mistral-large-latest": ["mistral-large-3"],
		"mistral-small-latest": ["mistral-small-2501"],
		// Qwen models
		"qwen-max": ["qwen3-max-preview", "qwen3-max-2025-09-23"],
		"qwen-plus": ["qwen3-235b-a22b-instruct-2507"],
		"qwen-turbo": ["qwen3.5-flash"],
		// Grok models
		"grok-3": ["grok-3-preview-02-24"],
		"grok-3-mini": ["grok-3-mini-preview"],
	};

	// Check mapped names
	const mapped = mappings[id];
	if (mapped) {
		for (const name of mapped) {
			const match = entries.find(
				(e) => e.model.toLowerCase() === name.toLowerCase(),
			);
			if (match) {
				return match;
			}
		}
	}

	const tokens = modelTokens(modelId);
	if (tokens.length === 0) {
		return null;
	}
	const candidates = entries.map((entry) => ({
		entry,
		tokens: modelTokens(entry.model),
	}));

	const sameWords = candidates.filter((c) => equalTokens(c.tokens, tokens));
	if (sameWords[0]) {
		return best(sameWords, (a, b) => a.entry.rank - b.entry.rank);
	}

	// Arena appends effort, thinking or preview words, so tolerate extra trailing
	// qualifiers. A trailing model word is a different model.
	const extended = candidates.filter(
		(c) =>
			c.tokens.length > tokens.length &&
			startsWithTokens(c.tokens, tokens) &&
			c.tokens.slice(tokens.length).every(isDiscountableToken),
	);
	if (extended[0]) {
		return best(
			extended,
			(a, b) =>
				a.tokens.length - b.tokens.length || a.entry.rank - b.entry.rank,
		);
	}

	// And the reverse: our ID carries qualifiers Arena drops, or a rollout Arena
	// lists differently (`deepseek-v4.1-flash-1017` against
	// `deepseek-v4.1-flash-max`). Only the Arena name's own words have to match.
	const shorter = candidates.filter(
		(c) =>
			c.tokens.length >= 2 &&
			c.tokens.length < tokens.length &&
			startsWithTokens(tokens, c.tokens) &&
			tokens.slice(c.tokens.length).every(isDiscountableToken),
	);
	if (shorter[0]) {
		return best(
			shorter,
			(a, b) =>
				b.tokens.length - a.tokens.length || a.entry.rank - b.entry.rank,
		);
	}

	// Both sides carry qualifiers (`claude-haiku-4-5` against
	// `claude-haiku-4-5-20251001`): keep the longest shared prefix that leaves
	// only qualifiers and dates behind.
	const aligned = candidates.filter((c) => {
		const shared = sharedPrefix(c.tokens, tokens);
		if (shared < 3 || DISTINCT_TOKENS.has(c.tokens[shared] ?? "")) {
			return false;
		}
		return (
			c.tokens.slice(shared).every(isDiscountableToken) &&
			tokens.slice(shared).every(isDiscountableToken)
		);
	});
	if (aligned[0]) {
		return best(
			aligned,
			(a, b) =>
				sharedPrefix(b.tokens, tokens) - sharedPrefix(a.tokens, tokens) ||
				Math.abs(a.tokens.length - tokens.length) -
					Math.abs(b.tokens.length - tokens.length) ||
				a.entry.rank - b.entry.rank,
		);
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Extracts the newest published overall ranking from a dataset snapshot. */
export function parseArenaRows(
	rows: readonly Record<string, unknown>[],
	subset: string,
): ArenaSnapshot {
	const overall = rows.filter(
		(row) => row.category === "overall" && typeof row.model_name === "string",
	);
	if (overall.length === 0) {
		return { entries: [], publishedAt: null };
	}

	const publishedAt =
		overall
			.map((row) => row.leaderboard_publish_date)
			.filter((date): date is string => typeof date === "string")
			.sort()
			.at(-1) ?? null;
	if (!publishedAt) {
		throw new Error(`Arena ${subset} snapshot has no publish date`);
	}

	const entries = overall
		.filter((row) => row.leaderboard_publish_date === publishedAt)
		.map((row) => {
			const rank = Number(row.rank);
			const score = Number(row.rating);
			if (!Number.isFinite(rank) || !Number.isFinite(score)) {
				throw new Error(
					`Arena ${subset} snapshot has a malformed row for ${String(row.model_name)}`,
				);
			}
			return {
				rank,
				model: row.model_name as string,
				score: Math.round(score),
			};
		})
		.sort((a, b) => a.rank - b.rank);

	return { entries, publishedAt };
}

/** Downloads and parses the `latest` parquet snapshot of a dataset subset. */
async function fetchSnapshot(subset: string): Promise<ArenaSnapshot> {
	const listing = await fetch(
		`https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/tree/${DATASET_REVISION}/${subset}`,
		{ signal: AbortSignal.timeout(10000) },
	);
	if (!listing.ok) {
		throw new Error(`Arena ${subset} listing returned HTTP ${listing.status}`);
	}
	const files: unknown = await listing.json();
	const snapshotPath = Array.isArray(files)
		? files.find(
				(file): file is { path: string } =>
					isRecord(file) &&
					typeof file.path === "string" &&
					file.path.startsWith(`${subset}/latest-`) &&
					file.path.endsWith(".parquet"),
			)?.path
		: undefined;
	if (!snapshotPath) {
		throw new Error(`Arena ${subset} has no latest parquet snapshot`);
	}

	const response = await fetch(
		`${DATASET_URL}/resolve/${DATASET_REVISION}/${snapshotPath}`,
		{ signal: AbortSignal.timeout(20000) },
	);
	if (!response.ok) {
		throw new Error(`Arena ${subset} returned HTTP ${response.status}`);
	}

	const rows = await parquetReadObjects({ file: await response.arrayBuffer() });
	return parseArenaRows(rows, subset);
}

/** `null` while Arena is unreachable and no earlier snapshot exists. */
export async function getArenaBenchmarks(): Promise<ArenaBenchmarks | null> {
	const now = Date.now();

	if (now < cacheExpiry) {
		return cachedData;
	}

	try {
		const [text, code] = await Promise.all([
			fetchSnapshot(SUBSETS.text),
			fetchSnapshot(SUBSETS.code),
		]);
		const publishedAt = [text.publishedAt, code.publishedAt]
			.filter((date): date is string => date !== null)
			.sort()
			.at(-1);
		if (!publishedAt) {
			throw new Error("Arena snapshots are empty");
		}
		cachedData = {
			text: text.entries,
			code: code.entries,
			fetchedAt: publishedAt,
		};
		cacheExpiry = now + CACHE_TTL_MS;
		return cachedData;
	} catch (error) {
		logger.error(
			"Arena leaderboard refresh failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		// Back off and keep the last good snapshot, so an Arena outage does not
		// refetch both leaderboards on every request or blank the leaderboard.
		cacheExpiry = now + RETRY_MS;
		return cachedData;
	}
}
