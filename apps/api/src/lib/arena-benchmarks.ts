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

async function fetchLeaderboard(
	category: "text" | "code",
): Promise<ArenaEntry[]> {
	try {
		const url = `https://arena.ai/leaderboard/${category}`;
		const response = await fetch(url, {
			headers: {
				Accept: "text/html",
				"User-Agent": "LLMGateway/1.0",
			},
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return [];
		}

		const html = await response.text();

		// Parse the leaderboard data from the page
		// Arena pages contain JSON data in script tags
		const entries: ArenaEntry[] = [];

		// Try to extract structured data from the page
		// The leaderboard data is typically embedded in Next.js __NEXT_DATA__ or similar
		const nextDataMatch = html.match(
			/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
		);

		if (nextDataMatch?.[1]) {
			try {
				const nextData = JSON.parse(nextDataMatch[1]);
				// Navigate the Next.js data structure to find leaderboard entries
				const props = nextData?.props?.pageProps;
				if (props?.leaderboard || props?.models || props?.data) {
					const data = props.leaderboard ?? props.models ?? props.data;
					if (Array.isArray(data)) {
						for (const item of data) {
							if (item.model && item.score) {
								entries.push({
									rank: item.rank ?? entries.length + 1,
									model: String(item.model),
									score: Number(item.score),
								});
							}
						}
					}
				}
			} catch {
				// JSON parse failed, fall through to regex
			}
		}

		if (entries.length > 0) {
			return entries;
		}

		// Fallback: look for JSON-LD or embedded data
		const jsonLdMatch = html.match(
			/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
		);
		if (jsonLdMatch) {
			for (const script of jsonLdMatch) {
				try {
					const content = script.replace(/<script[^>]*>|<\/script>/g, "");
					const data = JSON.parse(content);
					if (Array.isArray(data)) {
						for (const item of data) {
							if (item.model && item.score) {
								entries.push({
									rank: item.rank ?? entries.length + 1,
									model: String(item.model),
									score: Number(item.score),
								});
							}
						}
					}
				} catch {
					// skip invalid JSON
				}
			}
		}

		return entries;
	} catch {
		return [];
	}
}

/**
 * Static fallback data from Arena leaderboard (March 2026).
 * Used when live fetch fails.
 */
function getStaticBenchmarks(): ArenaBenchmarks {
	return {
		text: [
			{ rank: 1, model: "claude-opus-4-6-thinking", score: 1502 },
			{ rank: 2, model: "claude-opus-4-6", score: 1501 },
			{ rank: 3, model: "gemini-3.1-pro-preview", score: 1493 },
			{ rank: 4, model: "grok-4.20-beta1", score: 1492 },
			{ rank: 5, model: "gemini-3-pro", score: 1486 },
			{ rank: 6, model: "gpt-5.4-high", score: 1485 },
			{ rank: 7, model: "gpt-5.2-chat-latest-20260210", score: 1482 },
			{ rank: 8, model: "grok-4.20-beta-0309-reasoning", score: 1481 },
			{ rank: 9, model: "gemini-3-flash", score: 1475 },
			{
				rank: 10,
				model: "claude-opus-4-5-20251101-thinking-32k",
				score: 1474,
			},
			{ rank: 11, model: "grok-4.1-thinking", score: 1472 },
			{ rank: 12, model: "claude-opus-4-5-20251101", score: 1469 },
			{ rank: 13, model: "claude-sonnet-4-6", score: 1465 },
			{ rank: 14, model: "qwen3.5-max-preview", score: 1464 },
			{ rank: 15, model: "gpt-5.3-chat-latest", score: 1464 },
			{ rank: 17, model: "gpt-5.4", score: 1463 },
			{ rank: 19, model: "grok-4.1", score: 1461 },
			{ rank: 20, model: "gpt-5.1-high", score: 1455 },
			{ rank: 21, model: "glm-5", score: 1455 },
			{ rank: 22, model: "kimi-k2.5-thinking", score: 1453 },
			{ rank: 23, model: "claude-sonnet-4-5-20250929", score: 1453 },
			{ rank: 25, model: "ernie-5.0-0110", score: 1452 },
			{ rank: 26, model: "qwen3.5-397b-a17b", score: 1452 },
			{
				rank: 28,
				model: "claude-opus-4-1-20250805-thinking-16k",
				score: 1449,
			},
			{ rank: 29, model: "gemini-2.5-pro", score: 1448 },
			{ rank: 30, model: "claude-opus-4-1-20250805", score: 1447 },
			{ rank: 32, model: "gpt-4.5-preview-2025-02-27", score: 1444 },
			{ rank: 33, model: "chatgpt-4o-latest-20250326", score: 1443 },
			{ rank: 35, model: "gpt-5.2-high", score: 1442 },
			{ rank: 36, model: "gpt-5.2", score: 1440 },
			{ rank: 37, model: "gpt-5.1", score: 1439 },
			{ rank: 39, model: "qwen3-max-preview", score: 1435 },
			{ rank: 40, model: "gpt-5-high", score: 1434 },
			{ rank: 42, model: "o3-2025-04-16", score: 1432 },
			{ rank: 46, model: "gpt-5-chat", score: 1426 },
			{ rank: 48, model: "deepseek-v3.2-exp-thinking", score: 1425 },
			{ rank: 49, model: "deepseek-v3.2", score: 1425 },
			{ rank: 50, model: "qwen3-max-2025-09-23", score: 1424 },
			{
				rank: 51,
				model: "claude-opus-4-20250514-thinking-16k",
				score: 1424,
			},
			{ rank: 55, model: "deepseek-r1-0528", score: 1421 },
			{ rank: 58, model: "deepseek-v3.1", score: 1418 },
			{ rank: 64, model: "mistral-large-3", score: 1416 },
			{ rank: 68, model: "gpt-4.1-2025-04-14", score: 1413 },
			{ rank: 69, model: "claude-opus-4-20250514", score: 1413 },
			{ rank: 71, model: "gemini-2.5-flash", score: 1411 },
			{ rank: 76, model: "claude-haiku-4-5-20251001", score: 1407 },
			{ rank: 82, model: "o1-2024-12-17", score: 1402 },
			{ rank: 88, model: "claude-sonnet-4-20250514-thinking-32k", score: 1399 },
			{ rank: 89, model: "deepseek-r1", score: 1398 },
			{ rank: 93, model: "deepseek-v3-0324", score: 1394 },
			{ rank: 96, model: "o4-mini-2025-04-16", score: 1390 },
			{ rank: 97, model: "gpt-5-mini-high", score: 1390 },
			{ rank: 98, model: "claude-sonnet-4-20250514", score: 1389 },
			{ rank: 100, model: "o1-preview", score: 1388 },
			{ rank: 105, model: "llama-4-maverick", score: 1383 },
			{ rank: 120, model: "gpt-4o-2024-11-20", score: 1370 },
			{ rank: 135, model: "llama-3.3-70b-instruct", score: 1355 },
			{ rank: 150, model: "gpt-4o-mini-2024-07-18", score: 1340 },
			{ rank: 170, model: "llama-3.1-405b-instruct", score: 1320 },
			{ rank: 190, model: "mistral-small-2501", score: 1305 },
			{ rank: 210, model: "llama-3.1-70b-instruct", score: 1285 },
			{ rank: 250, model: "llama-3.1-8b-instruct", score: 1240 },
		],
		code: [
			{ rank: 1, model: "claude-opus-4-6", score: 1548 },
			{ rank: 2, model: "claude-opus-4-6-thinking", score: 1546 },
			{ rank: 3, model: "claude-sonnet-4-6", score: 1521 },
			{
				rank: 4,
				model: "claude-opus-4-5-20251101-thinking-32k",
				score: 1489,
			},
			{ rank: 5, model: "claude-opus-4-5-20251101", score: 1465 },
			{ rank: 6, model: "gpt-5.4-high", score: 1457 },
			{ rank: 7, model: "gemini-3.1-pro-preview", score: 1454 },
			{ rank: 8, model: "glm-5", score: 1445 },
			{ rank: 9, model: "minimax-m2.7", score: 1445 },
			{ rank: 11, model: "gemini-3-pro", score: 1437 },
			{ rank: 12, model: "gemini-3-flash", score: 1436 },
			{ rank: 14, model: "kimi-k2.5-thinking", score: 1431 },
			{ rank: 19, model: "gpt-5.2", score: 1400 },
			{ rank: 29, model: "gemini-2.5-pro", score: 1380 },
			{ rank: 40, model: "deepseek-r1", score: 1360 },
			{ rank: 50, model: "claude-sonnet-4-20250514", score: 1350 },
			{ rank: 55, model: "gemini-2.5-flash", score: 1340 },
			{ rank: 60, model: "mistral-large-3", score: 1330 },
		],
		fetchedAt: "2026-03-20",
	};
}

export async function getArenaBenchmarks(): Promise<ArenaBenchmarks> {
	const now = Date.now();

	if (cachedData && now < cacheExpiry) {
		return cachedData;
	}

	try {
		const [textEntries, codeEntries] = await Promise.all([
			fetchLeaderboard("text"),
			fetchLeaderboard("code"),
		]);

		if (textEntries.length > 0) {
			cachedData = {
				text: textEntries,
				code: codeEntries,
				fetchedAt: new Date().toISOString().split("T")[0]!,
			};
			cacheExpiry = now + CACHE_TTL_MS;
			return cachedData;
		}
	} catch {
		// Fall through to static data
	}

	// Use static fallback data
	cachedData = getStaticBenchmarks();
	cacheExpiry = now + CACHE_TTL_MS;
	return cachedData;
}
