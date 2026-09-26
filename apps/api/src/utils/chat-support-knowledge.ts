import { redisClient } from "@/auth/config.js";

import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Domains whose sitemaps are crawled to build the support assistant's
// knowledge of every public page across the product suite. The agent links to
// these URLs and can fetch their content on demand to ground answers.
export const KNOWLEDGE_SITEMAPS = [
	"https://llmgateway.io/sitemap.xml",
	"https://devpass.llmgateway.io/sitemap.xml",
	"https://docs.llmgateway.io/sitemap.xml",
	"https://lounge.llmgateway.io/sitemap.xml",
	"https://airside.llmgateway.io/sitemap.xml",
];

// Short, curated product summaries inlined into the system prompt so product
// scope, plans, pricing, and key pages are available without a tool call.
export const KNOWLEDGE_LLMS_TXT = [
	"https://llmgateway.io/llms.txt",
	"https://devpass.llmgateway.io/llms.txt",
	"https://lounge.llmgateway.io/llms.txt",
	"https://airside.llmgateway.io/llms.txt",
];

const DOCS_BASE_URL = "https://docs.llmgateway.io";

// Billing, refund, and invoice docs inlined into the system prompt. These are
// the most common support questions and their rules (windows, thresholds, who
// can act) must be quoted exactly, so they are not left to an optional fetch.
export const KNOWLEDGE_REFERENCE_DOCS = [
	"/learn/billing",
	"/learn/transactions",
	"/learn/invoices",
	"/learn/refunds",
	"/learn/reset-passes",
	"/learn/payg-overflow",
	"/learn/chat-plans",
].map((path) => `${DOCS_BASE_URL}${path}`);

// Docs pages are also served as raw markdown under /llms.mdx/<path>.
export function toDocsMarkdownUrl(url: string): string {
	const { pathname } = new URL(url);
	return `${DOCS_BASE_URL}/llms.mdx${pathname}`;
}

// Only pages on these hosts may be fetched by the agent's grounding tool.
// chat.llmgateway.io stays on the list after the move to lounge.llmgateway.io
// because links to the old host are still in the wild; it 301s to the new one.
const ALLOWED_HOSTS = [
	"llmgateway.io",
	"devpass.llmgateway.io",
	"docs.llmgateway.io",
	"lounge.llmgateway.io",
	"chat.llmgateway.io",
	"airside.llmgateway.io",
];

const URLS_CACHE_KEY = "chat_support_knowledge_urls_v3";
const OVERVIEWS_CACHE_KEY = "chat_support_knowledge_overviews_v2";
const REFERENCE_DOCS_CACHE_KEY = "chat_support_knowledge_reference_docs_v1";
const CATALOGUE_CACHE_KEY = "chat_support_catalogue_summary_v1";
const CATALOGUE_CACHE_TTL_SECONDS = 60 * 10; // 10 minutes
const URLS_CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours
const PAGE_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const FETCH_TIMEOUT_MS = 8000;
const MAX_URLS = 600;
const MAX_PAGE_CHARS = 6000;
const MAX_OVERVIEW_CHARS = 6000;
const MAX_REFERENCE_DOC_CHARS = 8000;

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
		return locs.filter((loc) => isAllowedKnowledgeUrl(loc));
	}

	// A sitemap index could reference arbitrary external URLs; only follow
	// nested sitemaps on the allowlisted product hosts to avoid SSRF.
	const nestedUrls = locs
		.filter((loc) => isAllowedKnowledgeUrl(loc))
		.slice(0, 20);
	const nested = await Promise.all(
		nestedUrls.map((nestedUrl) => fetchText(nestedUrl)),
	);
	return nested
		.flatMap((nestedXml) => (nestedXml ? extractLocs(nestedXml) : []))
		.filter((loc) => isAllowedKnowledgeUrl(loc));
}

// Keep curated overviews and guides first, then take one URL from each sitemap
// per round. Large catalogues cannot crowd guides or smaller products out of
// the fixed prompt budget.
export function selectKnowledgeUrls(
	priorityUrls: readonly string[],
	urlGroups: readonly (readonly string[])[],
	limit = MAX_URLS,
): string[] {
	if (limit <= 0) {
		return [];
	}

	const selected: string[] = [];
	const seen = new Set<string>();
	const add = (url: string | undefined): void => {
		if (
			!url ||
			selected.length >= limit ||
			seen.has(url) ||
			!isAllowedKnowledgeUrl(url)
		) {
			return;
		}
		seen.add(url);
		selected.push(url);
	};

	for (const url of priorityUrls) {
		add(url);
	}
	const guideGroups = urlGroups.map((urls) =>
		urls.filter((url) => {
			try {
				const { pathname } = new URL(url);
				return (
					(pathname === "/guides" || pathname.startsWith("/guides/")) &&
					isAllowedKnowledgeUrl(url)
				);
			} catch {
				return false;
			}
		}),
	);

	// Reserve representation for each product before a guide-heavy sitemap can
	// consume the remaining budget.
	for (const guides of guideGroups) {
		add(guides[0]);
	}
	for (let index = 0; index < urlGroups.length; index += 1) {
		if (guideGroups[index]!.length === 0) {
			add(urlGroups[index]!.find((url) => isAllowedKnowledgeUrl(url)));
		}
	}

	const guideRounds = Math.max(0, ...guideGroups.map((urls) => urls.length));
	for (
		let index = 0;
		index < guideRounds && selected.length < limit;
		index += 1
	) {
		for (const guides of guideGroups) {
			add(guides[index]);
			if (selected.length >= limit) {
				break;
			}
		}
	}

	const rounds = Math.max(0, ...urlGroups.map((urls) => urls.length));
	for (let index = 0; index < rounds && selected.length < limit; index += 1) {
		for (const urls of urlGroups) {
			add(urls[index]);
			if (selected.length >= limit) {
				break;
			}
		}
	}

	return selected;
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
	const urls = selectKnowledgeUrls(
		[...KNOWLEDGE_LLMS_TXT, ...KNOWLEDGE_REFERENCE_DOCS],
		results,
	);

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

export interface KnowledgeOverview {
	url: string;
	content: string;
}

// Fetches the llms.txt product overviews for the support assistant's system
// prompt. Cached in Redis alongside the URL list; failures degrade gracefully.
export async function getKnowledgeOverviews(): Promise<KnowledgeOverview[]> {
	try {
		const cached = await redisClient.get(OVERVIEWS_CACHE_KEY);
		if (cached) {
			return JSON.parse(cached) as KnowledgeOverview[];
		}
	} catch (error) {
		logger.warn("Chat support overviews cache read failed", { error });
	}

	const fetched = await Promise.all(
		KNOWLEDGE_LLMS_TXT.map(async (url) => {
			const text = await fetchText(url);
			return text
				? { url, content: text.trim().slice(0, MAX_OVERVIEW_CHARS) }
				: null;
		}),
	);
	const overviews = fetched.filter(
		(overview): overview is KnowledgeOverview => overview !== null,
	);

	if (overviews.length > 0) {
		try {
			await redisClient.set(
				OVERVIEWS_CACHE_KEY,
				JSON.stringify(overviews),
				"EX",
				URLS_CACHE_TTL_SECONDS,
			);
		} catch (error) {
			logger.warn("Chat support overviews cache write failed", { error });
		}
	}

	return overviews;
}

// Fetches the billing, refund, and invoice docs as markdown for the system
// prompt. Keyed by the canonical docs URL so the agent links to the HTML page.
export async function getKnowledgeReferenceDocs(): Promise<
	KnowledgeOverview[]
> {
	try {
		const cached = await redisClient.get(REFERENCE_DOCS_CACHE_KEY);
		if (cached) {
			return JSON.parse(cached) as KnowledgeOverview[];
		}
	} catch (error) {
		logger.warn("Chat support reference docs cache read failed", { error });
	}

	const fetched = await Promise.all(
		KNOWLEDGE_REFERENCE_DOCS.map(async (url) => {
			const text = await fetchText(toDocsMarkdownUrl(url));
			return text
				? { url, content: text.trim().slice(0, MAX_REFERENCE_DOC_CHARS) }
				: null;
		}),
	);
	const docs = fetched.filter((doc): doc is KnowledgeOverview => doc !== null);

	if (docs.length > 0) {
		try {
			await redisClient.set(
				REFERENCE_DOCS_CACHE_KEY,
				JSON.stringify(docs),
				"EX",
				URLS_CACHE_TTL_SECONDS,
			);
		} catch (error) {
			logger.warn("Chat support reference docs cache write failed", {
				error,
			});
		}
	}

	return docs;
}

export interface CatalogueSummary {
	modelCount: number;
	providerCount: number;
	freeModelCount: number;
	outputCounts: Record<string, number>;
	providers: string[];
	generatedAt: string;
}

interface CatalogueRows {
	models: { id: string; free: boolean; output: string[] }[];
	mappings: {
		modelId: string;
		providerId: string;
		deactivatedAt: Date | null;
	}[];
	providers: { id: string; name: string }[];
}

// Counts what the public models directory lists as routable right now: active
// models with at least one live mapping on an active provider. Deriving the
// numbers from the database keeps the assistant from quoting stale totals.
export function summarizeCatalogue(
	rows: CatalogueRows,
	now: Date = new Date(),
): CatalogueSummary {
	const providerNames = new Map(rows.providers.map((p) => [p.id, p.name]));
	const liveProvidersByModel = new Map<string, Set<string>>();
	for (const mapping of rows.mappings) {
		if (!providerNames.has(mapping.providerId)) {
			continue;
		}
		if (mapping.deactivatedAt && mapping.deactivatedAt <= now) {
			continue;
		}
		const providerIds =
			liveProvidersByModel.get(mapping.modelId) ?? new Set<string>();
		providerIds.add(mapping.providerId);
		liveProvidersByModel.set(mapping.modelId, providerIds);
	}

	const liveModels = rows.models.filter((model) =>
		liveProvidersByModel.has(model.id),
	);
	const liveProviderIds = new Set<string>();
	const outputCounts: Record<string, number> = {};
	for (const model of liveModels) {
		for (const providerId of liveProvidersByModel.get(model.id) ?? []) {
			liveProviderIds.add(providerId);
		}
		for (const output of new Set(model.output)) {
			outputCounts[output] = (outputCounts[output] ?? 0) + 1;
		}
	}

	return {
		modelCount: liveModels.length,
		providerCount: liveProviderIds.size,
		freeModelCount: liveModels.filter((model) => model.free).length,
		outputCounts,
		providers: Array.from(
			liveProviderIds,
			(id) => providerNames.get(id) ?? id,
		).sort((a, b) => a.localeCompare(b)),
		generatedAt: now.toISOString(),
	};
}

export async function getCatalogueSummary(): Promise<CatalogueSummary | null> {
	try {
		const cached = await redisClient.get(CATALOGUE_CACHE_KEY);
		if (cached) {
			return JSON.parse(cached) as CatalogueSummary;
		}
	} catch (error) {
		logger.warn("Chat support catalogue cache read failed", { error });
	}

	let summary: CatalogueSummary;
	try {
		const [models, mappings, providers] = await Promise.all([
			db.query.model.findMany({
				where: { status: { eq: "active" } },
				columns: { id: true, free: true, output: true },
			}),
			db.query.modelProviderMapping.findMany({
				where: { status: { eq: "active" } },
				columns: { modelId: true, providerId: true, deactivatedAt: true },
			}),
			db.query.provider.findMany({
				where: { status: { eq: "active" } },
				columns: { id: true, name: true },
			}),
		]);
		summary = summarizeCatalogue({ models, mappings, providers });
	} catch (error) {
		logger.warn("Chat support catalogue summary failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}

	if (summary.modelCount > 0) {
		try {
			await redisClient.set(
				CATALOGUE_CACHE_KEY,
				JSON.stringify(summary),
				"EX",
				CATALOGUE_CACHE_TTL_SECONDS,
			);
		} catch (error) {
			logger.warn("Chat support catalogue cache write failed", { error });
		}
	}

	return summary;
}

export function isAllowedKnowledgeUrl(url: string): boolean {
	try {
		const { hostname, pathname, protocol } = new URL(url);
		if (protocol !== "https:") {
			return false;
		}
		if (
			(hostname === "lounge.llmgateway.io" ||
				hostname === "chat.llmgateway.io") &&
			(pathname === "/share" || pathname.startsWith("/share/"))
		) {
			return false;
		}
		return ALLOWED_HOSTS.some((host) => hostname === host);
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

	const cacheKey = `chat_support_page_v2:${url}`;
	try {
		const cached = await redisClient.get(cacheKey);
		if (cached) {
			return cached;
		}
	} catch (error) {
		logger.warn("Chat support page cache read failed", { url, error });
	}

	// Plain-text sources (llms.txt, pricing.md, …) are already readable; the
	// HTML-stripping pass would only mangle their markdown. Docs pages have a
	// markdown mirror without the navigation chrome, so prefer it.
	const { hostname, pathname } = new URL(url);
	const isPlainText = pathname.endsWith(".txt") || pathname.endsWith(".md");
	const docsMarkdown =
		!isPlainText && hostname === new URL(DOCS_BASE_URL).hostname
			? await fetchText(toDocsMarkdownUrl(url))
			: null;
	const body = docsMarkdown ?? (await fetchText(url));
	if (!body) {
		return "Could not load this page right now.";
	}

	const text = (
		isPlainText || docsMarkdown ? body.trim() : htmlToText(body)
	).slice(0, MAX_PAGE_CHARS);

	try {
		await redisClient.set(cacheKey, text, "EX", PAGE_CACHE_TTL_SECONDS);
	} catch (error) {
		logger.warn("Chat support page cache write failed", { url, error });
	}

	return text;
}
