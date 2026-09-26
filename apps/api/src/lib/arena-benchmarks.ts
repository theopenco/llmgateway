import { logger } from "@llmgateway/logger";

/**
 * Arena benchmark data fetcher with caching.
 * Fetches leaderboard data from arena.ai and caches it for 24 hours.
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

let cachedData: ArenaBenchmarks | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Maps a model ID from our system to possible Arena leaderboard names.
 * Arena uses different naming conventions, so we need fuzzy matching.
 */
export function findArenaMatch(
	modelId: string,
	entries: ArenaEntry[],
): ArenaEntry | null {
	const id = modelId.toLowerCase();

	// Direct match
	const direct = entries.find((e) => e.model.toLowerCase() === id);
	if (direct) {
		return direct;
	}

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
		"gpt-5": ["gpt-5-chat", "gpt-5-high"],
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

	// Fuzzy: check if arena model name starts with our model ID
	const startsWith = entries.find((e) => e.model.toLowerCase().startsWith(id));
	if (startsWith) {
		return startsWith;
	}

	// Fuzzy: check if our model ID starts with arena model name
	const reverseMatch = entries.find((e) =>
		id.startsWith(e.model.toLowerCase()),
	);
	if (reverseMatch) {
		return reverseMatch;
	}

	return null;
}

export function parseArenaLeaderboard(
	html: string,
	category: "text" | "code",
): ArenaEntry[] {
	const chunks: string[] = [];
	for (const match of html.matchAll(
		/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g,
	)) {
		const chunk: unknown = JSON.parse(match[1]!);
		if (Array.isArray(chunk) && typeof chunk[1] === "string") {
			chunks.push(chunk[1]);
		}
	}
	const findEntries = (value: unknown): ArenaEntry[] | null => {
		if (!value || typeof value !== "object") {
			return null;
		}
		if (Array.isArray(value)) {
			for (const child of value) {
				const entries = findEntries(child);
				if (entries) {
					return entries;
				}
			}
			return null;
		}
		const record = value as Record<string, unknown>;
		if (
			record.arenaSlug === category &&
			record.leaderboardSlug === "overall" &&
			Array.isArray(record.entries)
		) {
			return record.entries.map((entry: unknown) => {
				if (!entry || typeof entry !== "object") {
					throw new Error("Invalid Arena entry");
				}
				const row = entry as Record<string, unknown>;
				if (
					typeof row.modelDisplayName !== "string" ||
					!row.modelDisplayName ||
					typeof row.rank !== "number" ||
					!Number.isFinite(row.rank) ||
					typeof row.rating !== "number" ||
					!Number.isFinite(row.rating)
				) {
					throw new Error("Invalid Arena entry");
				}
				return {
					rank: row.rank,
					model: row.modelDisplayName,
					score: row.rating,
				};
			});
		}
		for (const child of Object.values(record)) {
			const entries = findEntries(child);
			if (entries) {
				return entries;
			}
		}
		return null;
	};
	for (const line of chunks.join("").split("\n")) {
		const payload = line.slice(line.indexOf(":") + 1);
		if (!payload.startsWith("[") && !payload.startsWith("{")) {
			continue;
		}
		const entries = findEntries(JSON.parse(payload));
		if (entries?.length) {
			return entries;
		}
	}
	throw new Error(`Arena ${category} leaderboard data was not found`);
}

async function fetchLeaderboard(
	category: "text" | "code",
): Promise<ArenaEntry[]> {
	const response = await fetch(`https://arena.ai/leaderboard/${category}`, {
		headers: { Accept: "text/html", "User-Agent": "LLMGateway/1.0" },
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok) {
		throw new Error(`Arena ${category} returned HTTP ${response.status}`);
	}
	return parseArenaLeaderboard(await response.text(), category);
}

export async function getArenaBenchmarks(): Promise<ArenaBenchmarks> {
	const now = Date.now();
	if (cachedData && now < cacheExpiry) {
		return cachedData;
	}
	try {
		const [text, code] = await Promise.all([
			fetchLeaderboard("text"),
			fetchLeaderboard("code"),
		]);
		cachedData = {
			text,
			code,
			fetchedAt: new Date().toISOString().split("T")[0]!,
		};
		cacheExpiry = now + CACHE_TTL_MS;
		return cachedData;
	} catch (error) {
		logger.error(
			"Arena leaderboard refresh failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		if (!cachedData) {
			throw error;
		}
		const retryMs = 5 * 60 * 1000;
		cacheExpiry = now + retryMs;
		return cachedData;
	}
}
