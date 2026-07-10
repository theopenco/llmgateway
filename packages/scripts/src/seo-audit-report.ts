/* eslint-disable no-console */
import { fileURLToPath } from "node:url";

import { z } from "zod";

interface PageTarget {
	url: string;
	label: string;
}

interface PageEvidence {
	url: string;
	label: string;
	status: number;
	finalUrl: string;
	redirected: boolean;
	responseMs: number;
	xRobotsTag?: string;
	htmlLang?: string;
	title?: string;
	titleLength: number;
	metaDescription?: string;
	metaDescriptionLength: number;
	metaRobots?: string;
	canonical?: string;
	ogTitle: boolean;
	ogDescription: boolean;
	twitterCard: boolean;
	h1Count: number;
	firstH1?: string;
	h2Count: number;
	jsonLdTypes: string[];
	hreflangCount: number;
	imageCount: number;
	imagesMissingAlt: number;
	internalLinkCount: number;
	approxWordCount: number;
	error?: string;
}

interface SiteFileEvidence {
	url: string;
	status: number;
	sizeBytes: number;
	servedHtmlInstead: boolean;
	snippet?: string;
}

interface SitemapEvidence {
	url: string;
	status: number;
	isIndex: boolean;
	urlCount: number;
	sampleUrls: string[];
	error?: string;
}

interface AiBotAccess {
	bot: string;
	blocked: boolean;
}

interface Evidence {
	auditedAt: string;
	pages: PageEvidence[];
	robots: Array<{ host: string; status: number; content: string }>;
	aiBotAccess: Array<{ host: string; bots: AiBotAccess[] }>;
	sitemaps: SitemapEvidence[];
	machineReadableFiles: SiteFileEvidence[];
}

const PAGES: ReadonlyArray<PageTarget> = [
	{ url: "https://llmgateway.io/", label: "Home" },
	{ url: "https://llmgateway.io/models", label: "Models" },
	{ url: "https://llmgateway.io/pricing", label: "Pricing" },
	{ url: "https://llmgateway.io/blog", label: "Blog index" },
	{ url: "https://llmgateway.io/timeline", label: "Timeline" },
	{ url: "https://docs.llmgateway.io/", label: "Docs home" },
	{ url: "https://devpass.llmgateway.io/", label: "DevPass landing" },
	{ url: "https://chat.llmgateway.io/", label: "Chat landing" },
];

const ROBOTS_HOSTS: ReadonlyArray<string> = [
	"llmgateway.io",
	"docs.llmgateway.io",
	"devpass.llmgateway.io",
	"chat.llmgateway.io",
];

const SITEMAP_URLS: ReadonlyArray<string> = [
	"https://llmgateway.io/sitemap.xml",
	"https://docs.llmgateway.io/sitemap.xml",
];

const MACHINE_READABLE_URLS: ReadonlyArray<string> = [
	"https://llmgateway.io/llms.txt",
	"https://llmgateway.io/llms-full.txt",
	"https://llmgateway.io/pricing.md",
	"https://docs.llmgateway.io/llms.txt",
];

const AI_BOTS: ReadonlyArray<string> = [
	"GPTBot",
	"ChatGPT-User",
	"PerplexityBot",
	"ClaudeBot",
	"anthropic-ai",
	"Google-Extended",
	"Bingbot",
	"CCBot",
];

function nonEmpty(value: string | undefined): string | undefined {
	if (!value || value.trim() === "") {
		return undefined;
	}
	return value.trim();
}

const LLMGATEWAY_API_URL =
	nonEmpty(process.env.LLMGATEWAY_API_URL) ?? "https://api.llmgateway.io";
const LLMGATEWAY_API_KEY = nonEmpty(process.env.LLMGATEWAY_API_KEY);
const AUDIT_MODEL = nonEmpty(process.env.SEO_AUDIT_MODEL) ?? "gpt-5.6-sol";
const DISCORD_TRAFFIC_NOTIFICATION_URL = nonEmpty(
	process.env.DISCORD_TRAFFIC_NOTIFICATION_URL,
);

const FETCH_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 600_000;
const USER_AGENT = "llmgateway-seo-audit/1.0 (+https://llmgateway.io)";

async function fetchPage(
	url: string,
): Promise<{ response: Response; body: string; ms: number }> {
	const start = Date.now();
	const response = await fetch(url, {
		headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
		redirect: "follow",
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	const body = await response.text();
	return { response, body, ms: Date.now() - start };
}

function parseAttributes(tag: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(tag)) !== null) {
		attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
	}
	return attrs;
}

// Decode common entities instead of blanking them: erasing "&amp;" from
// titles previously produced false findings like a "missing &" typo.
function stripTags(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&(?:#x27|#39|apos);/gi, "'")
		.replace(/&(?:nbsp|#160);/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&[a-z#0-9]+;/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function collectJsonLdTypes(value: unknown, types: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectJsonLdTypes(item, types);
		}
		return;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const type = record["@type"];
		if (typeof type === "string") {
			types.add(type);
		} else if (Array.isArray(type)) {
			for (const t of type) {
				if (typeof t === "string") {
					types.add(t);
				}
			}
		}
		const graph = record["@graph"];
		if (graph) {
			collectJsonLdTypes(graph, types);
		}
	}
}

function extractPageEvidence(
	target: PageTarget,
	response: Response,
	html: string,
	ms: number,
): PageEvidence {
	const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
	const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

	let metaDescription: string | undefined;
	let metaRobots: string | undefined;
	let ogTitle = false;
	let ogDescription = false;
	let twitterCard = false;
	for (const tag of metaTags) {
		const attrs = parseAttributes(tag);
		const name = attrs.name?.toLowerCase();
		const property = attrs.property?.toLowerCase();
		if (name === "description" && metaDescription === undefined) {
			metaDescription = attrs.content;
		}
		if (name === "robots" && metaRobots === undefined) {
			metaRobots = attrs.content;
		}
		if (property === "og:title") {
			ogTitle = true;
		}
		if (property === "og:description") {
			ogDescription = true;
		}
		if (name === "twitter:card") {
			twitterCard = true;
		}
	}

	let canonical: string | undefined;
	let hreflangCount = 0;
	for (const tag of linkTags) {
		const attrs = parseAttributes(tag);
		const rel = attrs.rel?.toLowerCase();
		if (rel === "canonical" && canonical === undefined) {
			canonical = attrs.href;
		}
		if (rel === "alternate" && attrs.hreflang) {
			hreflangCount++;
		}
	}

	const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = titleMatch ? stripTags(titleMatch[1]) : undefined;

	const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
	const h2Count = (html.match(/<h2\b/gi) ?? []).length;

	const jsonLdTypes = new Set<string>();
	const jsonLdBlocks = [
		...html.matchAll(
			/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
		),
	];
	for (const block of jsonLdBlocks) {
		try {
			collectJsonLdTypes(JSON.parse(block[1]), jsonLdTypes);
		} catch {
			jsonLdTypes.add("(unparseable JSON-LD block)");
		}
	}

	const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
	let imagesMissingAlt = 0;
	for (const tag of imgTags) {
		const attrs = parseAttributes(tag);
		if (!nonEmpty(attrs.alt)) {
			imagesMissingAlt++;
		}
	}

	const pageHost = new URL(target.url).host;
	const anchorTags = html.match(/<a\b[^>]*>/gi) ?? [];
	let internalLinkCount = 0;
	for (const tag of anchorTags) {
		const href = parseAttributes(tag).href;
		if (!href) {
			continue;
		}
		if (href.startsWith("/") && !href.startsWith("//")) {
			internalLinkCount++;
		} else if (href.includes(`//${pageHost}`)) {
			internalLinkCount++;
		}
	}

	const visible = html
		.replace(/<head\b[\s\S]*?<\/head\s*>/gi, " ")
		.replace(/<script\b[\s\S]*?<\/script(?:\s[^>]*)?>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
		.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, " ")
		.replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ");
	const approxWordCount = stripTags(visible)
		.split(" ")
		.filter((w) => w.length > 0).length;

	const langMatch = /<html\b[^>]*>/i.exec(html);
	const htmlLang = langMatch
		? parseAttributes(langMatch[0]).lang
		: undefined;

	return {
		url: target.url,
		label: target.label,
		status: response.status,
		finalUrl: response.url,
		redirected: response.redirected,
		responseMs: ms,
		xRobotsTag: response.headers.get("x-robots-tag") ?? undefined,
		htmlLang,
		title,
		titleLength: title?.length ?? 0,
		metaDescription,
		metaDescriptionLength: metaDescription?.length ?? 0,
		metaRobots,
		canonical,
		ogTitle,
		ogDescription,
		twitterCard,
		h1Count: h1Matches.length,
		firstH1: h1Matches[0] ? stripTags(h1Matches[0][1]).slice(0, 200) : undefined,
		h2Count,
		jsonLdTypes: [...jsonLdTypes],
		hreflangCount,
		imageCount: imgTags.length,
		imagesMissingAlt,
		internalLinkCount,
		approxWordCount,
	};
}

function analyzeAiBotAccess(robotsTxt: string): AiBotAccess[] {
	interface Group {
		agents: string[];
		disallowAll: boolean;
	}
	const groups: Group[] = [];
	let current: Group | null = null;
	let lastLineWasAgent = false;
	for (const rawLine of robotsTxt.split("\n")) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) {
			continue;
		}
		const [key, ...rest] = line.split(":");
		const value = rest.join(":").trim();
		const directive = key.trim().toLowerCase();
		if (directive === "user-agent") {
			if (!current || !lastLineWasAgent) {
				current = { agents: [], disallowAll: false };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			lastLineWasAgent = true;
		} else {
			if (directive === "disallow" && value === "/" && current) {
				current.disallowAll = true;
			}
			lastLineWasAgent = false;
		}
	}
	return AI_BOTS.map((bot) => {
		const specific = groups.find((g) => g.agents.includes(bot.toLowerCase()));
		const wildcard = groups.find((g) => g.agents.includes("*"));
		const group = specific ?? wildcard;
		return { bot, blocked: group?.disallowAll ?? false };
	});
}

async function fetchSitemap(url: string): Promise<SitemapEvidence> {
	try {
		const { response, body } = await fetchPage(url);
		if (!response.ok) {
			return {
				url,
				status: response.status,
				isIndex: false,
				urlCount: 0,
				sampleUrls: [],
			};
		}
		const isIndex = /<sitemapindex/i.test(body);
		const locs = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(
			(m) => m[1],
		);
		if (!isIndex) {
			return {
				url,
				status: response.status,
				isIndex,
				urlCount: locs.length,
				sampleUrls: locs.slice(0, 10),
			};
		}
		let urlCount = 0;
		const sampleUrls: string[] = [];
		for (const child of locs.slice(0, 5)) {
			try {
				const childResult = await fetchPage(child);
				const childLocs = [
					...childResult.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi),
				].map((m) => m[1]);
				urlCount += childLocs.length;
				sampleUrls.push(...childLocs.slice(0, 3));
			} catch {
				sampleUrls.push(`(failed to fetch child sitemap ${child})`);
			}
		}
		return {
			url,
			status: response.status,
			isIndex,
			urlCount,
			sampleUrls: sampleUrls.slice(0, 12),
		};
	} catch (err) {
		return {
			url,
			status: 0,
			isIndex: false,
			urlCount: 0,
			sampleUrls: [],
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function collectEvidence(): Promise<Evidence> {
	const pages: PageEvidence[] = [];
	for (const target of PAGES) {
		try {
			const { response, body, ms } = await fetchPage(target.url);
			pages.push(extractPageEvidence(target, response, body, ms));
			console.log(`Fetched ${target.url} (${response.status}, ${ms}ms)`);
		} catch (err) {
			pages.push({
				url: target.url,
				label: target.label,
				status: 0,
				finalUrl: target.url,
				redirected: false,
				responseMs: 0,
				titleLength: 0,
				metaDescriptionLength: 0,
				ogTitle: false,
				ogDescription: false,
				twitterCard: false,
				h1Count: 0,
				h2Count: 0,
				jsonLdTypes: [],
				hreflangCount: 0,
				imageCount: 0,
				imagesMissingAlt: 0,
				internalLinkCount: 0,
				approxWordCount: 0,
				error: err instanceof Error ? err.message : String(err),
			});
			console.log(`Failed to fetch ${target.url}: ${String(err)}`);
		}
	}

	const robots: Array<{ host: string; status: number; content: string }> = [];
	const aiBotAccess: Array<{ host: string; bots: AiBotAccess[] }> = [];
	for (const host of ROBOTS_HOSTS) {
		try {
			const { response, body } = await fetchPage(`https://${host}/robots.txt`);
			const content = response.ok ? body.slice(0, 3500) : "";
			robots.push({ host, status: response.status, content });
			aiBotAccess.push({
				host,
				bots: analyzeAiBotAccess(response.ok ? body : ""),
			});
		} catch (err) {
			robots.push({ host, status: 0, content: `(error: ${String(err)})` });
		}
	}

	const sitemaps: SitemapEvidence[] = [];
	for (const url of SITEMAP_URLS) {
		sitemaps.push(await fetchSitemap(url));
	}

	const machineReadableFiles: SiteFileEvidence[] = [];
	for (const url of MACHINE_READABLE_URLS) {
		try {
			const { response, body } = await fetchPage(url);
			const contentType = response.headers.get("content-type") ?? "";
			const servedHtmlInstead = response.ok && contentType.includes("text/html");
			machineReadableFiles.push({
				url,
				status: response.status,
				sizeBytes: body.length,
				servedHtmlInstead,
				snippet:
					response.ok && !servedHtmlInstead ? body.slice(0, 1200) : undefined,
			});
		} catch {
			machineReadableFiles.push({
				url,
				status: 0,
				sizeBytes: 0,
				servedHtmlInstead: false,
			});
		}
	}

	return {
		auditedAt: new Date().toISOString(),
		pages,
		robots,
		aiBotAccess,
		sitemaps,
		machineReadableFiles,
	};
}

const auditResultSchema = z.object({
	summary: z.string(),
	score: z.number().min(0).max(100),
	findings: z
		.array(
			z.object({
				severity: z.enum(["high", "medium", "low"]),
				title: z.string(),
				detail: z.string(),
			}),
		)
		.max(8),
	quick_wins: z.array(z.string()).max(5),
});

type AuditResult = z.infer<typeof auditResultSchema>;

const RESPONSE_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["summary", "score", "findings", "quick_wins"],
	properties: {
		summary: { type: "string" },
		score: { type: "integer" },
		findings: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["severity", "title", "detail"],
				properties: {
					severity: { type: "string", enum: ["high", "medium", "low"] },
					title: { type: "string" },
					detail: { type: "string" },
				},
			},
		},
		quick_wins: { type: "array", items: { type: "string" } },
	},
} as const;

const SHARED_CONTEXT = `You are auditing the public web presence of LLM Gateway (llmgateway.io), an open-source LLM API gateway SaaS that routes OpenAI-compatible requests across 40+ providers. Products on separate hosts: llmgateway.io (marketing site + dashboard), docs.llmgateway.io (documentation), devpass.llmgateway.io (DevPass developer subscription), chat.llmgateway.io (Chat product).

Evidence provenance: all page evidence was extracted from raw server-rendered HTML WITHOUT executing JavaScript. JSON-LD types listed were found in the server HTML. If something could plausibly be injected client-side, phrase the finding cautiously instead of asserting absence.

HARD RULES:
- NEVER report findings about Next.js route segment config such as \`export const dynamic\`, force-dynamic vs force-static, SSR vs SSG rendering strategy, or recommend converting dynamic pages to static. Dynamic rendering is an intentional internal requirement. Skip this dimension entirely.
- A canonical of \`https://host\` for the root page \`https://host/\` is the SAME URL by spec — never report bare-domain root canonicals as a trailing-slash mismatch.
- Only report findings supported by the provided evidence. No speculation about pages not audited.
- Findings must be ordered by impact (most severe first), max 8 findings, each detail under 240 characters, concrete and actionable, citing the affected URL path(s).
- quick_wins: max 5 short one-line items that are easy and immediately beneficial.
- summary: 2-3 sentences overall health assessment.
- score: 0-100 (90+ excellent, 75-89 good with minor issues, 60-74 needs work, below 60 serious problems).
Respond with JSON only, matching the required schema.`;

const SEO_SYSTEM_PROMPT = `${SHARED_CONTEXT}

You are an expert technical SEO auditor performing a monthly SEO health audit. Assess in this priority order:
1. Crawlability & indexation: robots.txt mistakes, sitemap coverage/validity, noindex via meta robots or x-robots-tag on important pages, canonical correctness (self-referencing, consistent host/protocol/trailing slash), redirect behavior.
2. Technical foundations: HTTPS, response times (flag pages consistently slower than ~1.5s as a signal, not a verdict), URL structure.
3. On-page: unique compelling titles 50-60 chars, meta descriptions 150-160 chars, exactly one H1 per page with primary keyword, logical H2 usage, image alt coverage, internal linking depth, og/twitter tags.
4. Content quality: thin content (low word counts on key landing pages), E-E-A-T signals, structured data coverage (JSON-LD types present vs expected: Organization, Product, FAQPage, BlogPosting, BreadcrumbList, Dataset where relevant).
5. SaaS-specific: comparison/alternative pages, docs discoverability.`;

const AI_SEO_SYSTEM_PROMPT = `${SHARED_CONTEXT}

You are an expert in AI search optimization (AEO/GEO/LLMO) — getting content cited by Google AI Overviews, ChatGPT, Perplexity, Claude, Gemini and Copilot — performing a monthly AI-SEO audit. Assess the three pillars:
1. Structure (extractability): clear definitions near the top of key pages, H2s phrased like real queries, comparison tables, FAQ blocks, self-contained answer passages; FAQPage/Article/Product/ItemList schema presence.
2. Authority (citability): statistics with sources, freshness signals, expert/author attribution, E-E-A-T.
3. Presence (machine readability): llms.txt / llms-full.txt quality, structured pricing exposed to agents (e.g. /pricing.md), AI crawler access in robots.txt (GPTBot, ChatGPT-User, PerplexityBot, ClaudeBot, anthropic-ai, Google-Extended, Bingbot; CCBot is training-only and blocking it is a legitimate choice, not a finding), content reachable without JavaScript execution.

Follow Google's official stance: do NOT recommend chunking content into AI-bait fragments, separate AI-only content, or keyword stuffing. People-first content with extractable structure is the goal.
You cannot verify third-party presence (Wikipedia, Reddit, review sites) or live AI citations from this evidence — at most suggest monitoring as a quick win, never report their absence as a finding.`;

interface ChatCompletionResponse {
	choices?: Array<{ message?: { content?: string | null } }>;
	error?: { message?: string };
}

async function runAudit(
	kind: "SEO" | "AI SEO",
	systemPrompt: string,
	evidence: Evidence,
): Promise<AuditResult> {
	if (!LLMGATEWAY_API_KEY) {
		throw new Error(
			"LLMGATEWAY_API_KEY environment variable is required to run the audit.",
		);
	}
	console.log(`Running ${kind} audit via ${AUDIT_MODEL}...`);
	const response = await fetch(`${LLMGATEWAY_API_URL}/v1/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${LLMGATEWAY_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: AUDIT_MODEL,
			messages: [
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: `Here is this month's crawl evidence as JSON. Produce the ${kind} audit.\n\n${JSON.stringify(evidence)}`,
				},
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "audit_result",
					strict: true,
					schema: RESPONSE_JSON_SCHEMA,
				},
			},
		}),
		signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`${kind} audit LLM request failed: ${response.status} - ${await response.text()}`,
		);
	}
	const data = (await response.json()) as ChatCompletionResponse;
	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error(
			`${kind} audit returned no content: ${JSON.stringify(data).slice(0, 500)}`,
		);
	}
	const jsonText = content.slice(
		content.indexOf("{"),
		content.lastIndexOf("}") + 1,
	);
	const parsed = auditResultSchema.safeParse(JSON.parse(jsonText));
	if (!parsed.success) {
		throw new Error(
			`${kind} audit result failed validation: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

const SEVERITY_ICONS: Record<string, string> = {
	high: "🔴",
	medium: "🟠",
	low: "🟢",
};

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function truncateAtLine(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	const cut = text.slice(0, max);
	const lastBreak = cut.lastIndexOf("\n");
	return lastBreak > 0 ? cut.slice(0, lastBreak) : truncate(text, max);
}

function buildEmbed(
	kind: "SEO" | "AI SEO",
	icon: string,
	color: number,
	monthLabel: string,
	result: AuditResult,
) {
	const findings = result.findings.map(
		(f) =>
			`${SEVERITY_ICONS[f.severity]} **${truncate(f.title, 80)}** — ${truncate(
				f.detail,
				240,
			)}`,
	);
	const quickWins = result.quick_wins.map((w) => `• ${truncate(w, 150)}`);
	const sections = [
		`**Score: ${Math.round(result.score)}/100** — ${truncate(result.summary, 400)}`,
		"",
		"**Findings**",
		findings.length > 0 ? findings.join("\n") : "No findings — all clear.",
	];
	if (quickWins.length > 0) {
		sections.push("", "**Quick wins**", quickWins.join("\n"));
	}
	return {
		title: `${icon} Monthly ${kind} Audit · ${monthLabel}`,
		description: truncateAtLine(sections.join("\n"), 2700),
		color,
		footer: { text: `LLM Gateway · ${AUDIT_MODEL} audit` },
		timestamp: new Date().toISOString(),
	};
}

async function postToDiscord(
	embeds: Array<ReturnType<typeof buildEmbed>>,
): Promise<void> {
	if (!DISCORD_TRAFFIC_NOTIFICATION_URL) {
		throw new Error(
			"DISCORD_TRAFFIC_NOTIFICATION_URL environment variable is required to post the report.",
		);
	}
	const response = await fetch(DISCORD_TRAFFIC_NOTIFICATION_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ embeds }),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`Discord webhook error: ${response.status} - ${await response.text()}`,
		);
	}
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes("--dry-run");
	const monthLabel = new Date().toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

	console.log(`Collecting SEO evidence for ${monthLabel} audit...`);
	const evidence = await collectEvidence();
	console.log(
		`Evidence collected: ${evidence.pages.length} pages, ${evidence.sitemaps.length} sitemaps, ${evidence.machineReadableFiles.length} machine-readable files.`,
	);

	const [seoResult, aiSeoResult] = await Promise.all([
		runAudit("SEO", SEO_SYSTEM_PROMPT, evidence),
		runAudit("AI SEO", AI_SEO_SYSTEM_PROMPT, evidence),
	]);

	const embeds = [
		buildEmbed("SEO", "🔍", 0x0ea5e9, monthLabel, seoResult),
		buildEmbed("AI SEO", "🤖", 0xf59e0b, monthLabel, aiSeoResult),
	];

	if (dryRun) {
		console.log("\n--- DRY RUN (not posting to Discord) ---\n");
		for (const embed of embeds) {
			console.log(embed.title);
			console.log(embed.description);
			console.log("");
		}
		return;
	}

	await postToDiscord(embeds);
	console.log("SEO & AI-SEO audit posted to Discord.");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

export { collectEvidence, runAudit, buildEmbed };
export type { Evidence, AuditResult };
