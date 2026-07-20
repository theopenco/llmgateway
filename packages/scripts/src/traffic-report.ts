/* eslint-disable no-console */
import { fileURLToPath } from "node:url";

type Period = "week" | "month";

interface Range {
	start: Date; // inclusive
	end: Date; // exclusive
}

interface ReportWindow {
	period: Period;
	current: Range;
	previous: Range;
	rangeLabel: string;
	comparisonLabel: string;
}

interface ProductTraffic {
	pageviews: number;
	visitors: number;
	sessions: number;
}

interface PeriodPair {
	current: number;
	previous: number;
}

interface UrlTraffic {
	url: string;
	pageviews: number;
	visitors: number;
}

interface ConvertingUrl {
	url: string;
	signups: number;
	payers: number;
}

interface BlogConversion {
	path: string;
	readers: number;
	signups: number;
	payers: number;
}

interface ReportData {
	products: Map<string, { current: ProductTraffic; previous: ProductTraffic }>;
	overall: { current: ProductTraffic; previous: ProductTraffic };
	events: Map<string, PeriodPair>;
	sources: Array<{ source: string; visitors: number }>;
	sourcesByProduct: Map<string, Array<{ source: string; visitors: number }>>;
	traffic: Map<string, PeriodPair>; // bucket -> human/bot/ai
	topPages: UrlTraffic[];
	convertingPages: ConvertingUrl[];
	blogConversions: BlogConversion[];
}

const PRODUCTS: ReadonlyArray<{ host: string; label: string }> = [
	{ host: "llmgateway.io", label: "LLM Gateway" },
	{ host: "devpass.llmgateway.io", label: "DevPass" },
	{ host: "chat.llmgateway.io", label: "Chat" },
	{ host: "docs.llmgateway.io", label: "Docs" },
];

const EVENTS: ReadonlyArray<{ event: string; label: string }> = [
	{ event: "user_signed_up", label: "Signups" },
	{ event: "credits_purchased", label: "Credit purchases" },
	{ event: "dev_plan_started", label: "DevPass starts" },
	{ event: "chat_plan_started", label: "Chat plan starts" },
	{ event: "reset_pass_purchased", label: "Reset passes" },
	{ event: "onboarding_completed", label: "Onboarding done" },
	{ event: "playground_chat_sent", label: "Playground chats" },
	{ event: "cta_clicked", label: "CTA clicks" },
	{ event: "pricing_plan_clicked", label: "Pricing clicks" },
	{ event: "enterprise_contact_submitted", label: "Enterprise leads" },
];

const HOST_LIST = PRODUCTS.map((p) => `'${p.host}'`).join(",");

// The blog is served by the marketing site (apps/ui) only.
const BLOG_HOST = "llmgateway.io";

// Events that mean the person paid us money. Payment events are captured
// server-side against the purchasing user's id (see apps/api/src/stripe.ts),
// which is the same id the frontends pass to posthog.identify, so they share
// a person with that user's pageview journey.
const PAYMENT_EVENTS = [
	"credits_purchased",
	"dev_plan_started",
	"chat_plan_started",
	"reset_pass_purchased",
] as const;
const PAYMENT_EVENT_LIST = PAYMENT_EVENTS.map((e) => `'${e}'`).join(",");

// How far before a conversion a pageview may occur and still get credit.
const ATTRIBUTION_LOOKBACK_DAYS = 30;

function nonEmpty(value: string | undefined): string | undefined {
	if (!value || value.trim() === "") {
		return undefined;
	}
	return value.trim();
}

const POSTHOG_HOST =
	nonEmpty(process.env.POSTHOG_QUERY_HOST) ?? "https://us.posthog.com";
const POSTHOG_PROJECT_ID = nonEmpty(process.env.POSTHOG_PROJECT_ID);
const POSTHOG_PERSONAL_API_KEY = nonEmpty(process.env.POSTHOG_PERSONAL_API_KEY);
const DISCORD_TRAFFIC_NOTIFICATION_URL = nonEmpty(
	process.env.DISCORD_TRAFFIC_NOTIFICATION_URL,
);

const REQUEST_TIMEOUT_MS = 30_000;

function startOfUtcDay(d: Date): Date {
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
	);
}

const DAY_MS = 86_400_000;

function shiftDays(d: Date, days: number): Date {
	const offsetMs = days * DAY_MS;
	return new Date(d.getTime() + offsetMs);
}

function startOfUtcWeek(d: Date): Date {
	const day = startOfUtcDay(d);
	const diff = (day.getUTCDay() + 6) % 7; // days since Monday
	return shiftDays(day, -diff);
}

function startOfUtcMonth(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addUtcMonths(d: Date, n: number): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function formatDay(d: Date): string {
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

function buildWindow(period: Period, now: Date): ReportWindow {
	if (period === "week") {
		const thisWeek = startOfUtcWeek(now);
		const current: Range = {
			start: shiftDays(thisWeek, -7),
			end: thisWeek,
		};
		const previous: Range = {
			start: shiftDays(thisWeek, -14),
			end: shiftDays(thisWeek, -7),
		};
		const lastDay = shiftDays(current.end, -1);
		const startYear = current.start.getUTCFullYear();
		const endYear = lastDay.getUTCFullYear();
		const rangeLabel =
			startYear === endYear
				? `${formatDay(current.start)} – ${formatDay(lastDay)}, ${endYear}`
				: `${formatDay(current.start)}, ${startYear} – ${formatDay(
						lastDay,
					)}, ${endYear}`;
		return {
			period,
			current,
			previous,
			rangeLabel,
			comparisonLabel: "vs previous week",
		};
	}

	const thisMonth = startOfUtcMonth(now);
	const current: Range = { start: addUtcMonths(thisMonth, -1), end: thisMonth };
	const previous: Range = {
		start: addUtcMonths(thisMonth, -2),
		end: addUtcMonths(thisMonth, -1),
	};
	return {
		period,
		current,
		previous,
		rangeLabel: current.start.toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		}),
		comparisonLabel: "vs previous month",
	};
}

function hogqlTimestamp(d: Date): string {
	return d.toISOString().slice(0, 19).replace("T", " ");
}

async function runHogql(query: string): Promise<unknown[][]> {
	if (!POSTHOG_PERSONAL_API_KEY) {
		throw new Error(
			"POSTHOG_PERSONAL_API_KEY environment variable is required to query PostHog.",
		);
	}
	if (!POSTHOG_PROJECT_ID) {
		throw new Error(
			"POSTHOG_PROJECT_ID environment variable is required to query PostHog.",
		);
	}
	const response = await fetch(
		`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		},
	);
	if (!response.ok) {
		throw new Error(
			`PostHog query failed: ${response.status} - ${await response.text()}`,
		);
	}
	const data = (await response.json()) as { results?: unknown[][] };
	return data.results ?? [];
}

function num(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

async function fetchReport(window: ReportWindow): Promise<ReportData> {
	const prevStart = hogqlTimestamp(window.previous.start);
	const curStart = hogqlTimestamp(window.current.start);
	const curEnd = hogqlTimestamp(window.current.end);
	const periodExpr = `if(timestamp >= toDateTime('${curStart}'), 'current', 'previous')`;
	const rangeExpr = `timestamp >= toDateTime('${prevStart}') AND timestamp < toDateTime('${curEnd}')`;

	const perHostQuery = `
		SELECT properties.$host AS host, ${periodExpr} AS period,
			count() AS pageviews,
			count(DISTINCT person_id) AS visitors,
			count(DISTINCT properties.$session_id) AS sessions
		FROM events
		WHERE event = '$pageview' AND ${rangeExpr}
			AND properties.$host IN (${HOST_LIST})
		GROUP BY host, period`;

	const overallQuery = `
		SELECT ${periodExpr} AS period,
			count() AS pageviews,
			count(DISTINCT person_id) AS visitors,
			count(DISTINCT properties.$session_id) AS sessions
		FROM events
		WHERE event = '$pageview' AND ${rangeExpr}
			AND properties.$host IN (${HOST_LIST})
		GROUP BY period`;

	const eventList = EVENTS.map((e) => `'${e.event}'`).join(",");
	const eventsQuery = `
		SELECT event, ${periodExpr} AS period, count() AS hits
		FROM events
		WHERE event IN (${eventList}) AND ${rangeExpr}
		GROUP BY event, period`;

	const sourcesQuery = `
		SELECT coalesce(nullIf(properties.$referring_domain, ''), '$direct') AS source,
			count(DISTINCT person_id) AS visitors
		FROM events
		WHERE event = '$pageview'
			AND timestamp >= toDateTime('${curStart}') AND timestamp < toDateTime('${curEnd}')
			AND properties.$host IN (${HOST_LIST})
		GROUP BY source
		ORDER BY visitors DESC
		LIMIT 6`;

	const sourcesByProductQuery = `
		SELECT host, source, visitors
		FROM (
			SELECT host, source, visitors,
				row_number() OVER (PARTITION BY host ORDER BY visitors DESC) AS rn
			FROM (
				SELECT properties.$host AS host,
					coalesce(nullIf(properties.$referring_domain, ''), '$direct') AS source,
					count(DISTINCT person_id) AS visitors
				FROM events
				WHERE event = '$pageview'
					AND timestamp >= toDateTime('${curStart}') AND timestamp < toDateTime('${curEnd}')
					AND properties.$host IN (${HOST_LIST})
				GROUP BY host, source
			)
		)
		WHERE rn <= 3
		ORDER BY host, visitors DESC`;

	const trafficQuery = `
		SELECT ${periodExpr} AS period,
			multiIf(
				properties.$virt_traffic_category IN ('ai_crawler','ai_search','ai_assistant'), 'ai',
				properties.$virt_is_bot = true, 'bot',
				'human'
			) AS bucket,
			count() AS hits
		FROM events
		WHERE event = '$pageview' AND ${rangeExpr}
			AND properties.$host IN (${HOST_LIST})
		GROUP BY period, bucket`;

	const topPagesQuery = `
		SELECT concat(properties.$host, properties.$pathname) AS url,
			count() AS pageviews,
			count(DISTINCT person_id) AS visitors
		FROM events
		WHERE event = '$pageview'
			AND timestamp >= toDateTime('${curStart}') AND timestamp < toDateTime('${curEnd}')
			AND properties.$host IN (${HOST_LIST})
		GROUP BY url
		ORDER BY pageviews DESC
		LIMIT 10`;

	// Persons who converted (signed up / paid) during the current period, with
	// the timestamp of their first conversion of each kind.
	const lookbackStart = hogqlTimestamp(
		shiftDays(window.current.start, -ATTRIBUTION_LOOKBACK_DAYS),
	);
	const convertersSubquery = `
		SELECT person_id,
			min(if(event = 'user_signed_up', timestamp, NULL)) AS signed_up_at,
			min(if(event IN (${PAYMENT_EVENT_LIST}), timestamp, NULL)) AS paid_at
		FROM events
		WHERE event IN ('user_signed_up',${PAYMENT_EVENT_LIST})
			AND timestamp >= toDateTime('${curStart}') AND timestamp < toDateTime('${curEnd}')
		GROUP BY person_id`;

	// A page "converts" a person when they viewed it within the lookback
	// window before their first signup/payment of the period.
	const attributedTo = (conversionColumn: string): string =>
		`ifNull(e.timestamp <= ${conversionColumn} AND e.timestamp >= ${conversionColumn} - INTERVAL ${ATTRIBUTION_LOOKBACK_DAYS} DAY, 0)`;

	const convertingPagesQuery = `
		SELECT concat(e.properties.$host, e.properties.$pathname) AS url,
			uniqIf(e.person_id, ${attributedTo("c.paid_at")}) AS payers,
			uniqIf(e.person_id, ${attributedTo("c.signed_up_at")}) AS signups
		FROM events AS e
		JOIN (${convertersSubquery}) AS c ON e.person_id = c.person_id
		WHERE e.event = '$pageview'
			AND e.timestamp >= toDateTime('${lookbackStart}') AND e.timestamp < toDateTime('${curEnd}')
			AND e.properties.$host IN (${HOST_LIST})
		GROUP BY url
		HAVING payers > 0 OR signups > 0
		ORDER BY payers DESC, signups DESC
		LIMIT 5`;

	const blogConversionsQuery = `
		SELECT e.properties.$pathname AS path,
			uniqIf(e.person_id, e.timestamp >= toDateTime('${curStart}')) AS readers,
			uniqIf(e.person_id, ${attributedTo("c.signed_up_at")}) AS signups,
			uniqIf(e.person_id, ${attributedTo("c.paid_at")}) AS payers
		FROM events AS e
		LEFT JOIN (${convertersSubquery}) AS c ON e.person_id = c.person_id
		WHERE e.event = '$pageview'
			AND e.timestamp >= toDateTime('${lookbackStart}') AND e.timestamp < toDateTime('${curEnd}')
			AND e.properties.$host = '${BLOG_HOST}'
			AND e.properties.$pathname LIKE '/blog/%'
		GROUP BY path
		ORDER BY payers DESC, signups DESC, readers DESC
		LIMIT 5`;

	const [
		perHost,
		overall,
		events,
		sources,
		sourcesByHost,
		traffic,
		topPages,
		convertingPages,
		blogConversions,
	] = await Promise.all([
		runHogql(perHostQuery),
		runHogql(overallQuery),
		runHogql(eventsQuery),
		runHogql(sourcesQuery),
		runHogql(sourcesByProductQuery),
		runHogql(trafficQuery),
		runHogql(topPagesQuery),
		runHogql(convertingPagesQuery),
		runHogql(blogConversionsQuery),
	]);

	const products = new Map<
		string,
		{ current: ProductTraffic; previous: ProductTraffic }
	>();
	for (const { host } of PRODUCTS) {
		products.set(host, {
			current: { pageviews: 0, visitors: 0, sessions: 0 },
			previous: { pageviews: 0, visitors: 0, sessions: 0 },
		});
	}
	for (const row of perHost) {
		const host = String(row[0]);
		const entry = products.get(host);
		if (!entry) {
			continue;
		}
		const bucket = row[1] === "current" ? entry.current : entry.previous;
		bucket.pageviews = num(row[2]);
		bucket.visitors = num(row[3]);
		bucket.sessions = num(row[4]);
	}

	const overallData = {
		current: { pageviews: 0, visitors: 0, sessions: 0 },
		previous: { pageviews: 0, visitors: 0, sessions: 0 },
	};
	for (const row of overall) {
		const bucket =
			row[0] === "current" ? overallData.current : overallData.previous;
		bucket.pageviews = num(row[1]);
		bucket.visitors = num(row[2]);
		bucket.sessions = num(row[3]);
	}

	const eventsData = new Map<string, PeriodPair>();
	for (const { event } of EVENTS) {
		eventsData.set(event, { current: 0, previous: 0 });
	}
	for (const row of events) {
		const entry = eventsData.get(String(row[0]));
		if (!entry) {
			continue;
		}
		if (row[1] === "current") {
			entry.current = num(row[2]);
		} else {
			entry.previous = num(row[2]);
		}
	}

	const sourcesData = sources.map((row) => ({
		source: row[0] === "$direct" ? "direct" : String(row[0]),
		visitors: num(row[1]),
	}));

	const sourcesByProduct = new Map<
		string,
		Array<{ source: string; visitors: number }>
	>();
	for (const { host } of PRODUCTS) {
		sourcesByProduct.set(host, []);
	}
	for (const row of sourcesByHost) {
		const list = sourcesByProduct.get(String(row[0]));
		if (!list) {
			continue;
		}
		list.push({
			source: row[1] === "$direct" ? "direct" : String(row[1]),
			visitors: num(row[2]),
		});
	}

	const trafficData = new Map<string, PeriodPair>();
	for (const bucket of ["human", "bot", "ai"]) {
		trafficData.set(bucket, { current: 0, previous: 0 });
	}
	for (const row of traffic) {
		const entry = trafficData.get(String(row[1]));
		if (!entry) {
			continue;
		}
		if (row[0] === "current") {
			entry.current = num(row[2]);
		} else {
			entry.previous = num(row[2]);
		}
	}

	const topPagesData = topPages.map((row) => ({
		url: String(row[0]),
		pageviews: num(row[1]),
		visitors: num(row[2]),
	}));

	const convertingPagesData = convertingPages.map((row) => ({
		url: String(row[0]),
		payers: num(row[1]),
		signups: num(row[2]),
	}));

	const blogConversionsData = blogConversions.map((row) => ({
		path: String(row[0]),
		readers: num(row[1]),
		signups: num(row[2]),
		payers: num(row[3]),
	}));

	return {
		products,
		overall: overallData,
		events: eventsData,
		sources: sourcesData,
		sourcesByProduct,
		traffic: trafficData,
		topPages: topPagesData,
		convertingPages: convertingPagesData,
		blogConversions: blogConversionsData,
	};
}

function formatInt(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

function formatDelta(current: number, previous: number): string {
	if (previous === 0) {
		return current > 0 ? "new" : "–";
	}
	const pct = ((current - previous) / previous) * 100;
	const sign = pct > 0 ? "+" : "";
	return `${sign}${pct.toFixed(1)}%`;
}

type Align = "left" | "right";

function truncatePath(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function renderTable(
	headers: string[],
	rows: string[][],
	align: Align[],
): string {
	const widths = headers.map((header, i) =>
		Math.max(header.length, ...rows.map((row) => row[i].length)),
	);
	const pad = (cell: string, i: number): string =>
		align[i] === "right" ? cell.padStart(widths[i]) : cell.padEnd(widths[i]);
	const line = (cells: string[]): string =>
		cells.map((cell, i) => pad(cell, i)).join("  ");
	const divider = widths.map((w) => "─".repeat(w)).join("  ");
	return [line(headers), divider, ...rows.map(line)].join("\n");
}

function buildEmbed(window: ReportWindow, data: ReportData) {
	const periodTitle = window.period === "week" ? "Weekly" : "Monthly";
	const icon = window.period === "week" ? "📊" : "📈";

	const productRows = PRODUCTS.map(({ host, label }) => {
		const entry = data.products.get(host);
		const cur = entry?.current ?? { pageviews: 0, visitors: 0, sessions: 0 };
		const prev = entry?.previous ?? { pageviews: 0, visitors: 0, sessions: 0 };
		return [
			label,
			formatInt(cur.visitors),
			formatDelta(cur.visitors, prev.visitors),
			formatInt(cur.pageviews),
			formatInt(cur.sessions),
		];
	});
	productRows.push([
		"All (unique)",
		formatInt(data.overall.current.visitors),
		formatDelta(data.overall.current.visitors, data.overall.previous.visitors),
		formatInt(data.overall.current.pageviews),
		formatInt(data.overall.current.sessions),
	]);
	const productTable = renderTable(
		["Product", "Visitors", "Δ", "Views", "Sessions"],
		productRows,
		["left", "right", "right", "right", "right"],
	);

	const eventRows = EVENTS.map(({ event, label }) => {
		const pair = data.events.get(event) ?? { current: 0, previous: 0 };
		return [
			label,
			formatInt(pair.current),
			formatDelta(pair.current, pair.previous),
		];
	});
	const eventTable = renderTable(["Metric", "Count", "Δ"], eventRows, [
		"left",
		"right",
		"right",
	]);

	const topPagesTable = renderTable(
		["Page", "Views", "Visitors"],
		data.topPages.map((p) => [
			truncatePath(p.url, 40),
			formatInt(p.pageviews),
			formatInt(p.visitors),
		]),
		["left", "right", "right"],
	);

	const convertingTable = renderTable(
		["Page", "Payers", "Signups"],
		data.convertingPages.map((p) => [
			truncatePath(p.url, 40),
			formatInt(p.payers),
			formatInt(p.signups),
		]),
		["left", "right", "right"],
	);

	const blogTable = renderTable(
		["Post", "Readers", "Signups", "Payers"],
		data.blogConversions.map((b) => [
			truncatePath(b.path.replace(/^\/blog\//, ""), 34),
			formatInt(b.readers),
			formatInt(b.signups),
			formatInt(b.payers),
		]),
		["left", "right", "right", "right"],
	);

	const sources = data.sources
		.map((s) => `${s.source} (${formatInt(s.visitors)})`)
		.join(" · ");

	const sourcesByProduct = PRODUCTS.map(({ host, label }) => {
		const list = data.sourcesByProduct.get(host) ?? [];
		const formatted = list
			.map((s) => `${s.source} (${formatInt(s.visitors)})`)
			.join(" · ");
		return `${label} · ${formatted || "no data"}`;
	}).join("\n");

	const ai = data.traffic.get("ai") ?? { current: 0, previous: 0 };
	const human = data.traffic.get("human") ?? { current: 0, previous: 0 };
	const bot = data.traffic.get("bot") ?? { current: 0, previous: 0 };
	const totalHits = ai.current + human.current + bot.current;
	const aiAndBot = ai.current + bot.current;
	const automatedShare =
		totalHits > 0 ? ((aiAndBot / totalHits) * 100).toFixed(1) : "0.0";

	const description = [
		`**${window.rangeLabel}** · ${window.comparisonLabel}`,
		"",
		"**Traffic by product**",
		"```",
		productTable,
		"```",
		"**Conversions & engagement**",
		"```",
		eventTable,
		"```",
		"**Top pages**",
		"```",
		data.topPages.length > 0 ? topPagesTable : "no data",
		"```",
		"**Top converting pages** · viewed before signup/purchase",
		"```",
		data.convertingPages.length > 0 ? convertingTable : "no data",
		"```",
		"**Blog posts** · readers this period, conversions they drove",
		"```",
		data.blogConversions.length > 0 ? blogTable : "no data",
		"```",
		`**Top sources** · ${sources || "no data"}`,
		"",
		"**Top sources by product**",
		sourcesByProduct,
		"",
		`**AI & bots** · AI assistant/crawler views: ${formatInt(
			ai.current,
		)} (${formatDelta(ai.current, ai.previous)}) · automated share ${automatedShare}%`,
	].join("\n");

	return {
		title: `${icon} ${periodTitle} Traffic Report · ${window.rangeLabel}`,
		description,
		color: window.period === "week" ? 0x6366f1 : 0x8b5cf6,
		footer: { text: "LLM Gateway · PostHog analytics" },
		timestamp: new Date().toISOString(),
	};
}

async function postToDiscord(
	embed: ReturnType<typeof buildEmbed>,
): Promise<void> {
	if (!DISCORD_TRAFFIC_NOTIFICATION_URL) {
		throw new Error(
			"DISCORD_TRAFFIC_NOTIFICATION_URL environment variable is required to post the report.",
		);
	}
	const response = await fetch(DISCORD_TRAFFIC_NOTIFICATION_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ embeds: [embed] }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`Discord webhook error: ${response.status} - ${await response.text()}`,
		);
	}
}

function parsePeriod(): Period {
	const arg = process.argv.find((a) => a.startsWith("--period="));
	const value = arg?.slice("--period=".length);
	if (value === "month") {
		return "month";
	}
	if (value && value !== "week") {
		throw new Error(`Invalid --period: ${value} (expected "week" or "month")`);
	}
	return "week";
}

function parseAt(): Date {
	const arg = process.argv.find((a) => a.startsWith("--at="));
	if (!arg) {
		return new Date();
	}
	const date = new Date(arg.slice("--at=".length));
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid --at date: ${arg.slice("--at=".length)}`);
	}
	return date;
}

async function main(): Promise<void> {
	const period = parsePeriod();
	const dryRun = process.argv.includes("--dry-run");
	const window = buildWindow(period, parseAt());

	console.log(
		`Building ${period} traffic report for ${window.rangeLabel} (${window.comparisonLabel})`,
	);

	const data = await fetchReport(window);
	const embed = buildEmbed(window, data);

	if (dryRun) {
		console.log("\n--- DRY RUN (not posting to Discord) ---\n");
		console.log(embed.title);
		console.log(embed.description);
		return;
	}

	await postToDiscord(embed);
	console.log("Traffic report posted to Discord.");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

export { buildWindow, buildEmbed, fetchReport };
export type { ReportWindow, ReportData, Period };
