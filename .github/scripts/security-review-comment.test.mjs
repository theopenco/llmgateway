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

const built = buildComment(finding("a.ts", 10, "SQL injection"));
assert.equal(built.path, "a.ts");
assert.equal(built.line, 10);
assert.ok(built.body.startsWith("🤖 **Security Issue: SQL injection**\n"));
assert.ok(built.body.includes("**Exploit Scenario:** x"));

// A comment produced from the body round-trips to the same key.
assert.equal(
	existingKey({ path: "a.ts", line: 10, body: built.body }),
	built.key,
);
assert.equal(
	existingKey({ path: "a.ts", line: 10, body: "unrelated" }),
	undefined,
);

// A comment whose line moved (line: null, original_line kept) still matches.
assert.equal(
	existingKey({ path: "a.ts", line: null, original_line: 8, body: built.body }),
	built.key,
);

const existing = [
	{ path: "a.ts", line: null, original_line: 8, body: built.body },
];
const changed = ["a.ts", "b.ts"];
const out = selectNew(
	[
		finding("a.ts", 12, "SQL injection"),
		finding("a.ts", 12, "SQL injection"),
		finding("b.ts", 3, "XSS"),
		finding("c.ts", 1, "not in diff"),
	],
	existing,
	changed,
);
assert.deepEqual(
	out.map((c) => [c.path, c.line]),
	[["b.ts", 3]],
);

// Resolving a thread clears its high finding; others stay open.
const open = openHighFindings(
	[
		finding("a.ts", 12, "SQL injection"),
		finding("b.ts", 3, "XSS"),
		finding("b.ts", 9, "weak hash", "MEDIUM"),
	],
	[{ path: "a.ts", body: built.body }],
);
assert.deepEqual(
	open.map((c) => [c.path, c.line]),
	[["b.ts", 3]],
);

// Fallback field shapes from the scanner.
const alt = buildComment({
	path: "d.ts",
	start: { line: 7 },
	extra: { message: "m" },
});
assert.equal(alt.path, "d.ts");
assert.equal(alt.line, 7);
assert.ok(alt.body.includes("Security Issue: m**"));

console.log("security-review-comment: all assertions passed");
