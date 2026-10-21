// Posts security-review findings as inline review comments, skipping any
// finding that is already on the PR, and writes the high-severity findings
// whose threads are still open to findings-open.json for the failing step.
// Replaces the scanner's own scripts/comment-pr-findings.js, which stops
// posting altogether once one security comment exists.
//
// Used by security-review.yml via actions/github-script; testable with plain
// node (node .github/scripts/security-review-comment.test.mjs).

import { readFileSync, writeFileSync } from "node:fs";

export const MARKER = "🤖 **Security Issue:";

// A finding keeps its identity when a later commit moves the line, so the
// line is not part of the key.
export function findingKey(path, message) {
	return `${path}:${message.trim()}`;
}

export function buildComment(finding) {
	const file = finding.file || finding.path;
	const line = finding.line || finding.start?.line || 1;
	const message =
		finding.description ||
		finding.extra?.message ||
		"Security vulnerability detected";
	const severity = finding.severity || "HIGH";
	const category = finding.category || "security_issue";
	const exploit =
		finding.exploit_scenario || finding.extra?.metadata?.exploit_scenario;
	const recommendation =
		finding.recommendation || finding.extra?.metadata?.recommendation;

	let body = `${MARKER} ${message}**\n\n`;
	body += `**Severity:** ${severity}\n`;
	body += `**Category:** ${category}\n`;
	if (exploit) {
		body += `\n**Exploit Scenario:** ${exploit}\n`;
	}
	if (recommendation) {
		body += `\n**Recommendation:** ${recommendation}\n`;
	}
	return {
		path: file,
		line,
		side: "RIGHT",
		body,
		severity: String(severity).toUpperCase(),
		key: findingKey(file, message),
	};
}

// Key of an existing bot comment: path and the first line of the body.
export function existingKey(comment) {
	const match = comment.body?.match(/🤖 \*\*Security Issue: ([\s\S]*?)\*\*\n/);
	if (!match) {
		return undefined;
	}
	return findingKey(comment.path, match[1]);
}

// High-severity findings that have no resolved thread on the PR. Resolving a
// thread with a reason is how a false positive clears the check.
export function openHighFindings(findings, resolvedThreadComments) {
	const resolved = new Set(
		resolvedThreadComments.map(existingKey).filter((k) => k !== undefined),
	);
	return findings
		.map(buildComment)
		.filter((c) => c.severity === "HIGH" && !resolved.has(c.key))
		.map(({ path, line, key }) => ({ path, line, key }));
}

const RESOLVED_THREADS_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!, $after: String) {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			reviewThreads(first: 100, after: $after) {
				pageInfo { hasNextPage endCursor }
				nodes {
					isResolved
					path
					comments(first: 1) { nodes { body } }
				}
			}
		}
	}
}`;

async function listResolvedThreadComments(github, owner, repo, number) {
	const out = [];
	let after = null;
	do {
		const data = await github.graphql(RESOLVED_THREADS_QUERY, {
			owner,
			repo,
			number,
			after,
		});
		const threads = data.repository.pullRequest.reviewThreads;
		for (const thread of threads.nodes) {
			if (thread.isResolved && thread.comments.nodes[0]) {
				out.push({ path: thread.path, body: thread.comments.nodes[0].body });
			}
		}
		after = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
	} while (after);
	return out;
}

export function selectNew(findings, existingComments, changedFiles) {
	const changed = new Set(changedFiles);
	const seen = new Set(
		existingComments.map(existingKey).filter((k) => k !== undefined),
	);
	const out = [];
	for (const finding of findings) {
		const comment = buildComment(finding);
		if (!changed.has(comment.path) || seen.has(comment.key)) {
			continue;
		}
		seen.add(comment.key);
		out.push(comment);
	}
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
	const existing = await github.paginate(github.rest.pulls.listReviewComments, {
		owner,
		repo,
		pull_number: number,
		per_page: 100,
	});
	const comments = selectNew(
		findings,
		existing.filter((c) => c.user?.type === "Bot"),
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
	}
	const resolved = await listResolvedThreadComments(
		github,
		owner,
		repo,
		number,
	);
	const open = openHighFindings(findings, resolved);
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
