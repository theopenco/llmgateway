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

const DATASET_URL =
	"https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset";
const DATASET_REVISION = "main";
const SUBSETS = { text: "text_style_control", code: "webdev" } as const;

let cachedData: ArenaBenchmarks | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETRY_MS = 5 * 60 * 1000;

/** Splits a model name into lowercase word tokens, dropping qualifiers. */
function modelTokens(name: string): string[] {
	return name
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** `5` in `gpt-5.4` or `4` in `claude-opus-4-6` starts a new model version. */
function isVersionToken(token: string): boolean {
	return /^[0-9]/.test(token);
}

/** Release dates appear as trailing tokens: `20241022` or `2025-04-16`. */
function isDateToken(token: string): boolean {
	return /^[0-9]{6,}$/.test(token);
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
		"gpt-5": ["gpt-5-high", "gpt-5-chat", "gpt-5"],
		"gpt-5-mini": ["gpt-5-mini-high", "gpt-5-mini"],
		"gpt-4o": ["chatgpt-4o-latest-20250326", "gpt-4o-2024-11-20"],
		"gpt-4o-mini": ["gpt-4o-mini-2024-07-18"],
		"gpt-4-turbo": ["gpt-4-turbo-2024-04-09"],
		o3: ["o3-2025-04-16"],
		"o4-mini": ["o4-mini-2025-04-16"],
		o1: ["o1-2024-12-17"],
		"o1-mini": ["o1-mini"],
		"o1-preview": ["o1-preview"],
		// Gemini models
		"gemini-2.5-pro": ["gemini-2.5-pro"],
		"gemini-2.5-flash": ["gemini-2.5-flash"],
		"gemini-2.0-flash": ["gemini-2.0-flash-001"],
		// DeepSeek models
		"deepseek-r1": ["deepseek-r1", "deepseek-r1-0528"],
		"deepseek-v3": ["deepseek-v3-0324", "deepseek-v3"],
		"deepseek-chat": ["deepseek-v3-0324", "deepseek-v3"],
		// Llama models
		"llama-4-maverick": ["llama-4-maverick"],
		"llama-3.3-70b-instruct": ["llama-3.3-70b-instruct"],
		"llama-3.1-405b-instruct": ["llama-3.1-405b-instruct"],
		"llama-3.1-70b-instruct": ["llama-3.1-70b-instruct"],
		"llama-3.1-8b-instruct": ["llama-3.1-8b-instruct"],
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
	const qualified = (entry: ArenaEntry) => (entry.model.includes("(") ? 1 : 0);

	// Same words. Arena often publishes several effort variants of one model
	// (`Claude Opus 4.6` and `Claude Opus 4.6 (High)`), so prefer the plain
	// entry and otherwise the best-ranked one.
	const sameWords = candidates.filter(
		(c) =>
			c.tokens.length === tokens.length &&
			c.tokens.every((token, index) => token === tokens[index]),
	);
	if (sameWords[0]) {
		return sameWords.sort(
			(a, b) =>
				qualified(a.entry) - qualified(b.entry) || a.entry.rank - b.entry.rank,
		)[0]!.entry;
	}

	// Arena appends effort or thinking qualifiers (`gpt-5` vs `gpt-5-high`), so
	// accept extra trailing words as long as they are not a version number
	// (`gpt-5.4` is a different model than `gpt-5`).
	const extended = candidates.filter(
		(c) =>
			c.tokens.length > tokens.length &&
			tokens.every((token, index) => c.tokens[index] === token) &&
			!isVersionToken(c.tokens[tokens.length]!),
	);
	if (extended[0]) {
		return extended.sort(
			(a, b) =>
				qualified(a.entry) - qualified(b.entry) ||
				a.tokens.length - b.tokens.length ||
				a.entry.rank - b.entry.rank,
		)[0]!.entry;
	}

	// Our ID carries a date (`claude-3-5-sonnet-20241022`) that Arena keeps in a
	// qualifier: accept a shorter name whose remaining words are all dates.
	const dated = candidates.filter(
		(c) =>
			c.tokens.length >= 2 &&
			c.tokens.length < tokens.length &&
			c.tokens.every((token, index) => tokens[index] === token) &&
			tokens.slice(c.tokens.length).every(isDateToken),
	);
	if (dated[0]) {
		return dated.sort(
			(a, b) =>
				b.tokens.length - a.tokens.length || a.entry.rank - b.entry.rank,
		)[0]!.entry;
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
