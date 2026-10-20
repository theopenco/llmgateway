/* eslint-disable no-console */
import { fileURLToPath } from "node:url";

import {
	buildWindow,
	formatDelta,
	formatInt,
	postToDiscord,
	renderTable,
} from "./traffic-report.js";

import type { Period, ReportWindow } from "./traffic-report.js";

// Code-review health, posted alongside the traffic report. Human time is the
// scarce resource: approvals, comments and wait time per PR say how much of it
// review costs. Revert rate is the guardrail: if it rises while human time
// falls, review was not saved, only moved.

interface GitHubUser {
	login: string;
	type: string;
}

interface SearchItem {
	number: number;
	title: string;
	created_at: string;
	user: GitHubUser;
	pull_request?: { merged_at: string | null };
}

interface Review {
	state: string;
	submitted_at?: string;
	user: GitHubUser | null;
}

interface ReviewComment {
	created_at: string;
	user: GitHubUser | null;
}

interface PullRequestStats {
	number: number;
	title: string;
	author: string;
	createdAt: Date;
	mergedAt: Date;
	humanApprovals: number;
	humanComments: number;
	waitHours: number;
	revert: boolean;
	agentAuthored: boolean;
}

interface PeriodStats {
	merged: number;
	reverts: number;
	noHumanReview: number;
	agentAuthored: number;
	approvalsMedian: number;
	approvalsP95: number;
	commentsMedian: number;
	waitHoursMedian: number;
	waitHoursP95: number;
}

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;

function nonEmpty(value: string | undefined): string | undefined {
	if (!value || value.trim() === "") {
		return undefined;
	}
	return value.trim();
}

const GITHUB_TOKEN = nonEmpty(process.env.GITHUB_TOKEN);
const GITHUB_REPOSITORY =
	nonEmpty(process.env.GITHUB_REPOSITORY) ?? "theopenco/llmgateway";

// Logins that never count as a person: review bots and the agents that open
// PRs on a maintainer's behalf.
const BOT_SUFFIX = "[bot]";
const AGENT_LOGINS = new Set(["claude", "devin-ai-integration", "codex"]);

function isHuman(user: GitHubUser | null | undefined): boolean {
	if (!user) {
		return false;
	}
	return (
		user.type === "User" &&
		!user.login.endsWith(BOT_SUFFIX) &&
		!AGENT_LOGINS.has(user.login.toLowerCase())
	);
}

function isRevert(title: string): boolean {
	return /^revert\b|^revert:|^Revert "/i.test(title.trim());
}

async function githubJson<T>(path: string): Promise<T> {
	if (!GITHUB_TOKEN) {
		throw new Error(
			"GITHUB_TOKEN environment variable is required to query GitHub.",
		);
	}
	const response = await fetch(`${GITHUB_API}${path}`, {
		headers: {
			Authorization: `Bearer ${GITHUB_TOKEN}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`GitHub request failed: ${response.status} ${path} - ${await response.text()}`,
		);
	}
	return (await response.json()) as T;
}

async function githubPaginate<T>(path: string): Promise<T[]> {
	const items: T[] = [];
	for (let page = 1; page <= 10; page++) {
		const separator = path.includes("?") ? "&" : "?";
		const batch = await githubJson<T[]>(
			`${path}${separator}per_page=100&page=${page}`,
		);
		items.push(...batch);
		if (batch.length < 100) {
			break;
		}
	}
	return items;
}

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

async function listMergedPullRequests(
	start: Date,
	end: Date,
): Promise<SearchItem[]> {
	const lastDay = new Date(end.getTime() - 1);
	const q = encodeURIComponent(
		`repo:${GITHUB_REPOSITORY} is:pr is:merged merged:${isoDay(start)}..${isoDay(lastDay)}`,
	);
	const items: SearchItem[] = [];
	for (let page = 1; page <= 10; page++) {
		const data = await githubJson<{ items: SearchItem[] }>(
			`/search/issues?q=${q}&per_page=100&page=${page}`,
		);
		items.push(...data.items);
		if (data.items.length < 100) {
			break;
		}
	}
	return items.filter((item) => {
		const mergedAt = item.pull_request?.merged_at;
		if (!mergedAt) {
			return false;
		}
		const t = new Date(mergedAt).getTime();
		return t >= start.getTime() && t < end.getTime();
	});
}

async function pullRequestStats(item: SearchItem): Promise<PullRequestStats> {
	const base = `/repos/${GITHUB_REPOSITORY}/pulls/${item.number}`;
	const [reviews, comments] = await Promise.all([
		githubPaginate<Review>(`${base}/reviews`),
		githubPaginate<ReviewComment>(`${base}/comments`),
	]);
	const createdAt = new Date(item.created_at);
	const mergedAt = new Date(item.pull_request?.merged_at ?? item.created_at);

	const humanReviews = reviews.filter(
		(r) => isHuman(r.user) && r.user?.login !== item.user.login,
	);
	const humanApprovals = humanReviews.filter(
		(r) => r.state === "APPROVED",
	).length;
	const humanComments =
		humanReviews.filter((r) => r.state === "COMMENTED").length +
		comments.filter((c) => isHuman(c.user) && c.user?.login !== item.user.login)
			.length;

	const firstHuman = humanReviews
		.map((r) => (r.submitted_at ? new Date(r.submitted_at).getTime() : NaN))
		.filter((t) => !Number.isNaN(t))
		.sort((a, b) => a - b)[0];
	const waitEnd = firstHuman ?? mergedAt.getTime();
	const waitHours = Math.max(0, waitEnd - createdAt.getTime()) / 3_600_000;

	return {
		number: item.number,
		title: item.title,
		author: item.user.login,
		createdAt,
		mergedAt,
		humanApprovals,
		humanComments,
		waitHours,
		revert: isRevert(item.title),
		agentAuthored: !isHuman(item.user),
	};
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[index];
}

function summarize(prs: PullRequestStats[]): PeriodStats {
	const approvals = prs.map((p) => p.humanApprovals);
	const comments = prs.map((p) => p.humanComments);
	const waits = prs.map((p) => p.waitHours);
	return {
		merged: prs.length,
		reverts: prs.filter((p) => p.revert).length,
		noHumanReview: prs.filter(
			(p) => p.humanApprovals === 0 && p.humanComments === 0,
		).length,
		agentAuthored: prs.filter((p) => p.agentAuthored).length,
		approvalsMedian: percentile(approvals, 50),
		approvalsP95: percentile(approvals, 95),
		commentsMedian: percentile(comments, 50),
		waitHoursMedian: percentile(waits, 50),
		waitHoursP95: percentile(waits, 95),
	};
}

async function collect(start: Date, end: Date): Promise<PullRequestStats[]> {
	const items = await listMergedPullRequests(start, end);
	const stats: PullRequestStats[] = [];
	// Sequential: ~2 requests per PR, well inside the 5000/hour limit, and
	// no burst against the secondary rate limiter.
	for (const item of items) {
		stats.push(await pullRequestStats(item));
	}
	return stats;
}

function pct(part: number, whole: number): string {
	return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "–";
}

function hours(value: number): string {
	return value >= 48 ? `${(value / 24).toFixed(1)}d` : `${value.toFixed(1)}h`;
}

function buildReviewEmbed(
	window: ReportWindow,
	current: PullRequestStats[],
	previous: PullRequestStats[],
) {
	const cur = summarize(current);
	const prev = summarize(previous);
	const periodTitle = window.period === "week" ? "Weekly" : "Monthly";

	const table = renderTable(
		["Metric", "Now", "Before", "Δ"],
		[
			[
				"PRs merged",
				formatInt(cur.merged),
				formatInt(prev.merged),
				formatDelta(cur.merged, prev.merged),
			],
			[
				"Reverted",
				`${formatInt(cur.reverts)} (${pct(cur.reverts, cur.merged)})`,
				`${formatInt(prev.reverts)} (${pct(prev.reverts, prev.merged)})`,
				formatDelta(cur.reverts, prev.reverts),
			],
			[
				"Merged w/o human review",
				`${formatInt(cur.noHumanReview)} (${pct(cur.noHumanReview, cur.merged)})`,
				`${formatInt(prev.noHumanReview)} (${pct(prev.noHumanReview, prev.merged)})`,
				formatDelta(cur.noHumanReview, prev.noHumanReview),
			],
			[
				"Agent-authored",
				`${formatInt(cur.agentAuthored)} (${pct(cur.agentAuthored, cur.merged)})`,
				`${formatInt(prev.agentAuthored)} (${pct(prev.agentAuthored, prev.merged)})`,
				formatDelta(cur.agentAuthored, prev.agentAuthored),
			],
			[
				"Human approvals / PR (p50 · p95)",
				`${cur.approvalsMedian} · ${cur.approvalsP95}`,
				`${prev.approvalsMedian} · ${prev.approvalsP95}`,
				formatDelta(cur.approvalsMedian, prev.approvalsMedian),
			],
			[
				"Human comments / PR (p50)",
				`${cur.commentsMedian}`,
				`${prev.commentsMedian}`,
				formatDelta(cur.commentsMedian, prev.commentsMedian),
			],
			[
				"Wait for a person (p50 · p95)",
				`${hours(cur.waitHoursMedian)} · ${hours(cur.waitHoursP95)}`,
				`${hours(prev.waitHoursMedian)} · ${hours(prev.waitHoursP95)}`,
				formatDelta(cur.waitHoursMedian, prev.waitHoursMedian),
			],
		],
		["left", "right", "right", "right"],
	);

	const reverts = current
		.filter((p) => p.revert)
		.map((p) => `#${p.number} ${p.title}`)
		.slice(0, 10);

	const description = [
		`**${window.rangeLabel}** · ${window.comparisonLabel}`,
		"",
		"**Review cost and guardrail** · wait = PR opened → first human review (or merge)",
		"```",
		table,
		"```",
		reverts.length > 0
			? `**Reverts** · ${reverts.join(" · ")}`
			: "**Reverts** · none",
	].join("\n");

	return {
		title: `🔍 ${periodTitle} Review Report · ${window.rangeLabel}`,
		description,
		color: window.period === "week" ? 0x0ea5e9 : 0x0284c7,
		footer: { text: `LLM Gateway · GitHub ${GITHUB_REPOSITORY}` },
		timestamp: new Date().toISOString(),
	};
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
		`Building ${period} review report for ${window.rangeLabel} (${window.comparisonLabel})`,
	);

	const [current, previous] = await Promise.all([
		collect(window.current.start, window.current.end),
		collect(window.previous.start, window.previous.end),
	]);
	const embed = buildReviewEmbed(window, current, previous);

	if (dryRun) {
		console.log("\n--- DRY RUN (not posting to Discord) ---\n");
		console.log(embed.title);
		console.log(embed.description);
		return;
	}

	await postToDiscord(embed);
	console.log("Review report posted to Discord.");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

export { buildReviewEmbed, summarize, isRevert, percentile };
