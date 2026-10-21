// Posts security-review findings as inline review comments, skipping any
// finding that is already on the PR. Replaces the scanner's own
// scripts/comment-pr-findings.js, which stops posting altogether once one
// security comment exists.
//
// Used by security-review.yml via actions/github-script; testable with plain
// node (node .github/scripts/security-review-comment.test.mjs).

import { readFileSync } from "node:fs";

export const MARKER = "🤖 **Security Issue:";

export function findingKey(path, line, message) {
	return `${path}:${line}:${message.trim()}`;
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
		key: findingKey(file, line, message),
	};
}

// Key of an existing bot comment: path, line and the first line of the body.
export function existingKey(comment) {
	const match = comment.body?.match(/🤖 \*\*Security Issue: ([\s\S]*?)\*\*\n/);
	if (!match) {
		return undefined;
	}
	return findingKey(
		comment.path,
		comment.line ?? comment.original_line,
		match[1],
	);
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
	if (comments.length === 0) {
		return;
	}
	const head = context.payload.pull_request.head.sha;
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
