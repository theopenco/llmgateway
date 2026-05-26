import { redisClient } from "@/auth/config.js";

import { logger } from "@llmgateway/logger";

// Domains whose sitemaps are crawled to build the support assistant's
// knowledge of every public page across the product suite. The agent links to
// these URLs and can fetch their content on demand to ground answers.
const KNOWLEDGE_SITEMAPS = [
	"https://llmgateway.io/sitemap.xml",
	"https://devpass.llmgateway.io/sitemap.xml",
	"https://docs.llmgateway.io/sitemap.xml",
	"https://chat.llmgateway.io/sitemap.xml",
];

// Only pages on these hosts may be fetched by the agent's grounding tool.
const ALLOWED_HOSTS = [
	"llmgateway.io",
	"devpass.llmgateway.io",
	"docs.llmgateway.io",
	"chat.llmgateway.io",
];

const URLS_CACHE_KEY = "chat_support_knowledge_urls";
const URLS_CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours
const PAGE_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const FETCH_TIMEOUT_MS = 8000;
const MAX_URLS = 600;
const MAX_PAGE_CHARS = 6000;

function extractLocs(xml: string): string[] {
	const matches = xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi);
	return Array.from(matches, (m) => m[1]!.trim()).filter(Boolean);
}

async function fetchText(url: string): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": "LLMGateway-SupportBot/1.0" },
		});
		if (!res.ok) {
			return null;
		}
		return await res.text();
	} catch (error) {
		logger.warn("Chat support knowledge fetch failed", {
			url,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

// A sitemap index points to nested sitemaps; resolve one level of nesting so we
// pick up per-section sitemaps (common with Next.js and docs generators).
async function collectSitemapUrls(sitemapUrl: string): Promise<string[]> {
	const xml = await fetchText(sitemapUrl);
	if (!xml) {
		return [];
	}

	const locs = extractLocs(xml);
	const isIndex = /<sitemapindex/i.test(xml);
	if (!isIndex) {
		return locs;
	}

	// A sitemap index could reference arbitrary external URLs; only follow
	// nested sitemaps on the allowlisted product hosts to avoid SSRF.
	const nestedUrls = locs
		.filter((loc) => isAllowedKnowledgeUrl(loc))
		.slice(0, 20);
	const nested = await Promise.all(
		nestedUrls.map((nestedUrl) => fetchText(nestedUrl)),
	);
	return nested.flatMap((nestedXml) =>
		nestedXml ? extractLocs(nestedXml) : [],
	);
}

export async function getKnowledgeUrls(): Promise<string[]> {
	try {
		const cached = await redisClient.get(URLS_CACHE_KEY);
		if (cached) {
			return JSON.parse(cached) as string[];
		}
	} catch (error) {
		logger.warn("Chat support knowledge cache read failed", { error });
	}

	const results = await Promise.all(
		KNOWLEDGE_SITEMAPS.map((sitemap) => collectSitemapUrls(sitemap)),
	);
	const urls = Array.from(new Set(results.flat())).slice(0, MAX_URLS);

	if (urls.length > 0) {
		try {
			await redisClient.set(
				URLS_CACHE_KEY,
				JSON.stringify(urls),
				"EX",
				URLS_CACHE_TTL_SECONDS,
			);
		} catch (error) {
			logger.warn("Chat support knowledge cache write failed", { error });
		}
	}

	return urls;
}

export function isAllowedKnowledgeUrl(url: string): boolean {
	try {
		const { hostname, protocol } = new URL(url);
		if (protocol !== "https:") {
			return false;
		}
		return ALLOWED_HOSTS.some(
			(host) => hostname === host || hostname.endsWith(`.${host}`),
		);
	} catch {
		return false;
	}
}

const HTML_ENTITIES: Record<string, string> = {
	"&nbsp;": " ",
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#x27;": "'",
	"&#39;": "'",
};

function htmlToText(html: string): string {
	return (
		html
			// Robustly drop <script>/<style> blocks. The end tag uses `[^>]*` so
			// it also matches malformed closers like `</script\t\n bar>`, and the
			// inner pattern avoids lazy-match bypasses.
			.replace(
				/<script\b[^<]*(?:(?!<\/script[^>]*>)<[^<]*)*<\/script[^>]*>/gi,
				" ",
			)
			.replace(
				/<style\b[^<]*(?:(?!<\/style[^>]*>)<[^<]*)*<\/style[^>]*>/gi,
				" ",
			)
			.replace(/<[^>]+>/g, " ")
			// Decode entities in a single pass so a decoded "&" can't be
			// re-interpreted as the start of another entity (double-unescaping).
			.replace(
				/&(?:nbsp|amp|lt|gt|quot|#x27|#39);/g,
				(match) => HTML_ENTITIES[match] ?? match,
			)
			.replace(/\s+/g, " ")
			.trim()
	);
}

export async function fetchKnowledgePage(url: string): Promise<string> {
	if (!isAllowedKnowledgeUrl(url)) {
		return "This page is outside the LLM Gateway documentation and cannot be read.";
	}

	const cacheKey = `chat_support_page:${url}`;
	try {
		const cached = await redisClient.get(cacheKey);
		if (cached) {
			return cached;
		}
	} catch (error) {
		logger.warn("Chat support page cache read failed", { url, error });
	}

	const html = await fetchText(url);
	if (!html) {
		return "Could not load this page right now.";
	}

	const text = htmlToText(html).slice(0, MAX_PAGE_CHARS);

	try {
		await redisClient.set(cacheKey, text, "EX", PAGE_CACHE_TTL_SECONDS);
	} catch (error) {
		logger.warn("Chat support page cache write failed", { url, error });
	}

	return text;
}
