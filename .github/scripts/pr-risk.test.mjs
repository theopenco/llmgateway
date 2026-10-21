// node .github/scripts/pr-risk.test.mjs
import assert from "node:assert/strict";

import {
	classifyRisk,
	gateDecision,
	labelRisk,
	parseCodeRabbitLevel,
	pickReviewer,
} from "./pr-risk.mjs";

const file = (filename, additions = 1, deletions = 1) => ({
	filename,
	additions,
	deletions,
});
const review = (login, commit_id, state = "APPROVED") => ({
	user: { login },
	commit_id,
	state,
});
const sha = "abc1234567";

assert.equal(parseCodeRabbitLevel("**Merge Risk:** **⚪ Minimal**"), "low");
assert.equal(parseCodeRabbitLevel("**Merge Risk:** **🟡 Moderate**"), "medium");
assert.equal(parseCodeRabbitLevel("**Merge Risk:** **🔴 High**"), "high");
assert.equal(parseCodeRabbitLevel("nothing"), undefined);

const risk = (files, codeRabbitLevel, author) =>
	classifyRisk({ files, codeRabbitLevel, author }).risk;
assert.equal(risk([file("README.md")], "low", "smakosh"), "low");
assert.equal(risk([file("README.md")], "low", "someone"), "medium");
assert.equal(risk([file("apps/gateway/src/x.ts")], "low", "smakosh"), "medium");
assert.equal(
	risk([file("packages/db/migrations/x.sql")], undefined, "smakosh"),
	"high",
);
assert.equal(risk([file("apps/api/src/stripe.ts")], "low", "smakosh"), "high");
assert.equal(
	risk(
		[file("a.ts", 600, 500), file("pnpm-lock.yaml", 9000, 0)],
		"low",
		"smakosh",
	),
	"medium",
);
assert.equal(risk([file("a.ts")], "high", "smakosh"), "high");

assert.equal(pickReviewer(3, "smakosh"), "steebchen");
assert.equal(pickReviewer(4, "steebchen"), "smakosh");

assert.equal(labelRisk(["risk: high", "bug"]), "high");
assert.equal(labelRisk(["bug"]), undefined);

const gate = (risk, author, reviews) =>
	gateDecision({ risk, author, reviews, headSha: sha }).state;
assert.equal(gate("low", "smakosh", []), "success");
assert.equal(gate("medium", "smakosh", []), "success");
assert.equal(gate("high", "smakosh", []), "failure");
assert.equal(gate("high", "smakosh", [review("steebchen", sha)]), "success");
assert.equal(gate("high", "smakosh", [review("smakosh", sha)]), "failure");
assert.equal(gate("high", "smakosh", [review("steebchen", "old")]), "failure");
assert.equal(
	gate("high", "smakosh", [
		review("steebchen", sha),
		review("steebchen", sha, "CHANGES_REQUESTED"),
	]),
	"failure",
);
assert.equal(
	gate("high", "smakosh", [
		review("steebchen", sha),
		review("steebchen", sha, "COMMENTED"),
	]),
	"success",
);
assert.equal(
	gate("high", "smakosh", [
		review("steebchen", sha, "CHANGES_REQUESTED"),
		review("steebchen", sha, "DISMISSED"),
	]),
	"failure",
);
assert.equal(gate("low", "outsider", []), "failure");
assert.equal(gate("low", "outsider", [review("rando", sha)]), "failure");
assert.equal(gate("low", "outsider", [review("smakosh", sha)]), "success");
assert.equal(
	gate("high", "outsider", [
		review("smakosh", sha),
		review("steebchen", sha, "CHANGES_REQUESTED"),
	]),
	"failure",
);

console.log("pr-risk: all assertions passed");
