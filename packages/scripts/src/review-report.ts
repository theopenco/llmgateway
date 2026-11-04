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

interface Actor {
	login: string;
	__typename: string;
}

interface ReviewNode {
	state: string;
	submittedAt: string | null;
	author: Actor | null;
	commit: { oid: string } | null;
	comments: { totalCount: number };
}

interface PullRequestNode {
	number: number;
	title: string;
	createdAt: string;
	mergedAt: string | null;
	author: Actor | null;
	reviews: { totalCount: number; nodes: ReviewNode[] };
}

interface SearchPage {
	search: {
		issueCount: number;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
		nodes: Array<Partial<PullRequestNode>>;
	};
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

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const REQUEST_TIMEOUT_MS = 30_000;
// GITHUB_TOKEN inside Actions gets 1,000 GraphQL points per hour per
// repository. One page of 100 PRs with up to 50 reviews each costs about 50
// points, so a month of PRs stays far below the limit.
const PAGE_SIZE = 100;
const REVIEWS_PER_PR = 50;
const MAX_PAGES = 10;

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
const AGENT_LOGINS = new Set(["claude", "devin-ai-integration", "codex"]);

function isHuman(actor: Actor | null | undefined): boolean {
	if (!actor) {
		return false;
	}
	return (
		actor.__typename === "User" &&
		!actor.login.endsWith("[bot]") &&
		!AGENT_LOGINS.has(actor.login.toLowerCase())
	);
}

function isRevert(title: string): boolean {
	return /^revert\b|^revert:|^Revert "/i.test(title.trim());
}

const SEARCH_QUERY = `
query ($q: String!, $first: Int!, $after: String, $reviews: Int!) {
	search(query: $q, type: ISSUE, first: $first, after: $after) {
		issueCount
		pageInfo { hasNextPage endCursor }
		nodes {
			... on PullRequest {
				number
				title
				createdAt
				mergedAt
				author { login __typename }
				reviews(first: $reviews) {
					totalCount
					nodes {
						state
						submittedAt
						author { login __typename }
						commit { oid }
						comments { totalCount }
					}
				}
			}
		}
	}
}`;

async function graphql<T>(
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	if (!GITHUB_TOKEN) {
		throw new Error(
			"GITHUB_TOKEN environment variable is required to query GitHub.",
		);
	}
	const response = await fetch(GITHUB_GRAPHQL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${GITHUB_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`GitHub GraphQL request failed: ${response.status} - ${await response.text()}`,
		);
	}
	const payload = (await response.json()) as {
		data?: T;
		errors?: Array<{ message: string }>;
	};
	if (payload.errors?.length || !payload.data) {
		throw new Error(
			`GitHub GraphQL errors: ${(payload.errors ?? []).map((e) => e.message).join("; ")}`,
		);
	}
	return payload.data;
}

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

// Search takes whole days, so the window is re-applied on mergedAt below.
async function listMergedPullRequests(
	start: Date,
	end: Date,
): Promise<PullRequestNode[]> {
	const lastDay = new Date(end.getTime() - 1);
	const q = `repo:${GITHUB_REPOSITORY} is:pr is:merged merged:${isoDay(start)}..${isoDay(lastDay)}`;
	const nodes: PullRequestNode[] = [];
	let after: string | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const data: SearchPage = await graphql<SearchPage>(SEARCH_QUERY, {
			q,
			first: PAGE_SIZE,
			after,
			reviews: REVIEWS_PER_PR,
		});
		for (const node of data.search.nodes) {
			if (node.number !== undefined && node.reviews) {
				nodes.push(node as PullRequestNode);
			}
		}
		if (!data.search.pageInfo.hasNextPage) {
			break;
		}
		after = data.search.pageInfo.endCursor;
	}
	return nodes.filter((pr) => {
		if (!pr.mergedAt) {
			return false;
		}
		const t = new Date(pr.mergedAt).getTime();
		return t >= start.getTime() && t < end.getTime();
	});
}

function pullRequestStats(pr: PullRequestNode): PullRequestStats {
	const createdAt = new Date(pr.createdAt);
	const mergedAt = new Date(pr.mergedAt ?? pr.createdAt);
	const authorLogin = pr.author?.login ?? "ghost";

	const humanReviews = pr.reviews.nodes.filter(
		(r) => isHuman(r.author) && r.author?.login !== authorLogin,
	);
	const humanApprovals = humanReviews.filter(
		(r) => r.state === "APPROVED",
	).length;
	// A review with inline comments carries them in comments.totalCount; a
	// body-only "comment" review counts as one.
	const humanComments = humanReviews.reduce(
		(sum, r) =>
			sum +
			(r.comments.totalCount > 0
				? r.comments.totalCount
				: r.state === "COMMENTED"
					? 1
					: 0),
		0,
	);

	const firstHuman = humanReviews
		.map((r) => (r.submittedAt ? new Date(r.submittedAt).getTime() : NaN))
		.filter((t) => !Number.isNaN(t))
		.sort((a, b) => a - b)[0];
	const waitEnd = firstHuman ?? mergedAt.getTime();
	const waitHours = Math.max(0, waitEnd - createdAt.getTime()) / 3_600_000;

	return {
		number: pr.number,
		title: pr.title,
		author: authorLogin,
		createdAt,
		mergedAt,
		humanApprovals,
		humanComments,
		waitHours,
		revert: isRevert(pr.title),
		agentAuthored: !isHuman(pr.author),
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
	const prs = await listMergedPullRequests(start, end);
	return prs.map(pullRequestStats);
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

	const current = await collect(window.current.start, window.current.end);
	const previous = await collect(window.previous.start, window.previous.end);
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
