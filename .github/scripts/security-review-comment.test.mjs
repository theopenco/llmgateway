// node .github/scripts/security-review-comment.test.mjs
import assert from "node:assert/strict";

import {
	buildComment,
	existingKey,
	openHighFindings,
	selectNew,
} from "./security-review-comment.mjs";

const finding = (file, line, description, severity = "HIGH") => ({
	file,
	line,
	description,
	severity,
	category: "injection",
	exploit_scenario: "x",
	recommendation: "y",
});
// Fake sources: a.ts has the same vulnerable line at 10 and 20, and a different
// one at 30.
const SOURCE = {
	"a.ts": {
		10: "db.query(sql + input)",
		20: "db.query(sql + input)",
		30: "exec(cmd)",
	},
	"b.ts": { 3: "innerHTML = x" },
};
const read = (path, line) => SOURCE[path]?.[line] ?? "";
const thread = (body, isResolved = false, isOutdated = false) => ({
	body,
	isResolved,
	isOutdated,
});

const built = buildComment(finding("a.ts", 10, "SQL injection"), read);
assert.equal(built.path, "a.ts");
assert.equal(built.line, 10);
assert.match(
	built.body,
	/^<!-- security-finding:[0-9a-f]{16} -->\n🤖 \*\*Security Issue: SQL injection\*\*\n/,
);
assert.ok(built.body.includes("**Exploit Scenario:** x"));
assert.equal(existingKey(built.body), built.key);
assert.equal(existingKey("unrelated"), undefined);

// Same message, different code: different findings.
const other = buildComment(finding("a.ts", 30, "SQL injection"), read);
assert.notEqual(other.key, built.key);
// Same message, same code elsewhere in the file: same finding (a moved line).
assert.equal(
	buildComment(finding("a.ts", 20, "SQL injection"), read).key,
	built.key,
);

const changed = ["a.ts", "b.ts"];
const out = selectNew(
	[
		finding("a.ts", 20, "SQL injection"),
		finding("a.ts", 20, "SQL injection"),
		finding("a.ts", 30, "SQL injection"),
		finding("b.ts", 3, "XSS"),
		finding("c.ts", 1, "not in diff"),
	],
	[thread(built.body)],
	changed,
	read,
);
assert.deepEqual(
	out.map((c) => [c.path, c.line]),
	[
		["a.ts", 30],
		["b.ts", 3],
	],
);

// An outdated thread (the flagged line was edited) no longer deduplicates.
assert.equal(
	selectNew(
		[finding("a.ts", 10, "SQL injection")],
		[thread(built.body, true, true)],
		changed,
		read,
	).length,
	1,
);

// Resolving a still-anchored thread clears its high finding; an open thread
// keeps it open; a resolved but outdated thread anchors nothing, so the
// finding is unanchored rather than open; a finding with no thread at all is
// unanchored too; medium findings never count.
const xss = buildComment(finding("b.ts", 3, "XSS"), read);
const { open, unanchored } = openHighFindings(
	[
		finding("a.ts", 10, "SQL injection"),
		finding("a.ts", 30, "SQL injection"),
		finding("b.ts", 3, "XSS"),
		finding("b.ts", 3, "weak hash", "MEDIUM"),
		finding("c.ts", 1, "RCE"),
	],
	[
		thread(built.body, true),
		thread(other.body, true, true),
		thread(xss.body, false),
	],
	read,
);
assert.deepEqual(
	open.map((c) => [c.path, c.line]),
	[["b.ts", 3]],
);
assert.deepEqual(
	unanchored.map((c) => [c.path, c.line]),
	[
		["a.ts", 30],
		["c.ts", 1],
	],
);

// Fallback field shapes from the scanner.
const alt = buildComment(
	{ path: "d.ts", start: { line: 7 }, extra: { message: "m" } },
	read,
);
assert.equal(alt.path, "d.ts");
assert.equal(alt.line, 7);
assert.ok(alt.body.includes("Security Issue: m**"));

console.log("security-review-comment: all assertions passed");
