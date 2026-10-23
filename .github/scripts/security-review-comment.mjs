// Posts security-review findings as inline review comments, skipping any
// finding that is already on the PR, and writes the high-severity findings
// whose threads are still open to findings-open.json for the failing step.
// Replaces the scanner's own scripts/comment-pr-findings.js, which stops
// posting altogether once one security comment exists.
//
// Identity of a finding: path, category, message and the text of the flagged
// source line. Two findings with the same message on different code get
// different keys; a line that only moved keeps its key. Threads count only
// while GitHub still anchors them to unchanged code (not outdated): once the
// flagged line is edited, the next scan posts a fresh comment and a previous
// resolution no longer clears it.
//
// Used by security-review.yml via actions/github-script; testable with plain
// node (node .github/scripts/security-review-comment.test.mjs).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const MARKER = "🤖 **Security Issue:";
const KEY_MARKER = /<!-- security-finding:([0-9a-f]{16}) -->/;

export function readSourceLine(path, line) {
	try {
		return readFileSync(path, "utf8").split("\n")[line - 1] ?? "";
	} catch {
		return "";
	}
}

export function findingKey({ path, category, message, source }) {
	return createHash("sha256")
		.update([path, category, message.trim(), source.trim()].join("\0"))
		.digest("hex")
		.slice(0, 16);
}

export function buildComment(finding, readLine = readSourceLine) {
	const file = finding.file || finding.path;
	const line = finding.line || finding.start?.line || 1;
	const message =
		finding.description ||
		finding.extra?.message ||
		"Security vulnerability detected";
	const severity = String(finding.severity || "HIGH").toUpperCase();
	const category = finding.category || "security_issue";
	const exploit =
		finding.exploit_scenario || finding.extra?.metadata?.exploit_scenario;
	const recommendation =
		finding.recommendation || finding.extra?.metadata?.recommendation;
	const key = findingKey({
		path: file,
		category,
		message,
		source: readLine(file, line),
	});

	let body = `<!-- security-finding:${key} -->\n${MARKER} ${message}**\n\n`;
	body += `**Severity:** ${severity}\n`;
	body += `**Category:** ${category}\n`;
	if (exploit) {
		body += `\n**Exploit Scenario:** ${exploit}\n`;
	}
	if (recommendation) {
		body += `\n**Recommendation:** ${recommendation}\n`;
	}
	return { path: file, line, side: "RIGHT", body, severity, key };
}

// Key carried by an existing comment body, if it is one of ours.
export function existingKey(body) {
	return body?.match(KEY_MARKER)?.[1];
}

// threads: [{ isResolved, isOutdated, body }] for the PR's review threads.
export function selectNew(findings, threads, changedFiles, readLine) {
	const changed = new Set(changedFiles);
	const seen = new Set(
		threads
			.filter((t) => !t.isOutdated)
			.map((t) => existingKey(t.body))
			.filter((k) => k !== undefined),
	);
	const out = [];
	for (const finding of findings) {
		const comment = buildComment(finding, readLine);
		if (!changed.has(comment.path) || seen.has(comment.key)) {
			continue;
		}
		seen.add(comment.key);
		out.push(comment);
	}
	return out;
}

// High-severity findings with no resolved, still-anchored thread. Resolving
// a thread with a reason is how a false positive clears the check.
export function openHighFindings(findings, threads, readLine) {
	const resolved = new Set(
		threads
			.filter((t) => t.isResolved && !t.isOutdated)
			.map((t) => existingKey(t.body))
			.filter((k) => k !== undefined),
	);
	const open = new Map();
	for (const finding of findings) {
		const c = buildComment(finding, readLine);
		if (c.severity === "HIGH" && !resolved.has(c.key) && !open.has(c.key)) {
			open.set(c.key, { path: c.path, line: c.line, key: c.key });
		}
	}
	return [...open.values()];
}

const THREADS_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!, $after: String) {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			reviewThreads(first: 100, after: $after) {
				pageInfo { hasNextPage endCursor }
				nodes {
					isResolved
					isOutdated
					comments(first: 1) { nodes { body } }
				}
			}
		}
	}
}`;

async function listThreads(github, owner, repo, number) {
	const out = [];
	let after = null;
	do {
		const data = await github.graphql(THREADS_QUERY, {
			owner,
			repo,
			number,
			after,
		});
		const threads = data.repository.pullRequest.reviewThreads;
		for (const thread of threads.nodes) {
			out.push({
				isResolved: thread.isResolved,
				isOutdated: thread.isOutdated,
				body: thread.comments.nodes[0]?.body,
			});
		}
		after = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
	} while (after);
	return out;
}

export async function postFindings({ github, context, core }) {
	const { owner, repo } = context.repo;
	const number = context.payload.pull_request.number;
	const findings = JSON.parse(readFileSync("findings.json", "utf8"));
	writeFileSync("findings-open.json", "[]");
	if (findings.length === 0) {
		core.info("no findings to post");
		return;
	}
	const files = await github.paginate(github.rest.pulls.listFiles, {
		owner,
		repo,
		pull_number: number,
		per_page: 100,
	});
	let threads = await listThreads(github, owner, repo, number);
	const comments = selectNew(
		findings,
		threads,
		files.map((f) => f.filename),
	);
	core.info(`${findings.length} finding(s), ${comments.length} new`);
	if (comments.length > 0) {
		await postReview(
			github,
			owner,
			repo,
			number,
			context.payload.pull_request.head.sha,
			comments,
			core,
		);
		threads = await listThreads(github, owner, repo, number);
	}
	const open = openHighFindings(findings, threads);
	writeFileSync("findings-open.json", JSON.stringify(open, null, "\t"));
	core.info(
		`${open.length} high-severity finding(s) without a resolved thread`,
	);
}

async function postReview(github, owner, repo, number, head, comments, core) {
	try {
		await github.rest.pulls.createReview({
			owner,
			repo,
			pull_number: number,
			commit_id: head,
			event: "COMMENT",
			comments: comments.map(({ path, line, side, body }) => ({
				path,
				line,
				side,
				body,
			})),
		});
	} catch (error) {
		// A line outside the diff fails the whole review; post one by one and
		// keep the rest.
		core.warning(
			`review failed (${error.message}); posting comments individually`,
		);
		for (const { path, line, side, body } of comments) {
			try {
				await github.rest.pulls.createReviewComment({
					owner,
					repo,
					pull_number: number,
					commit_id: head,
					path,
					line,
					side,
					body,
				});
			} catch (lineError) {
				core.warning(
					`could not comment on ${path}:${line}: ${lineError.message}`,
				);
			}
		}
	}
}
