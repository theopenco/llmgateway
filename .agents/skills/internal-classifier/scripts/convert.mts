// usage (from the repository root):
//   pnpm exec tsx --tsconfig apps/api/tsconfig.json .agents/skills/internal-classifier/scripts/convert.mts <outDir> <raw*.ndjson.gz>
// Builds the admin export CSV from fetch.sh dumps with the export's own code,
// then the redacted copy for the classifier vendor and its summaries.
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

import { internalClassifierChecksFromLog } from "../../../../apps/api/src/lib/internal-classifier-checks.ts";
import {
	INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS,
	internalClassifierCheckCsvLine,
} from "../../../../apps/api/src/routes/admin-internal-classifier-checks.ts";

import type { InternalClassifierCheck } from "../../../../apps/api/src/lib/internal-classifier-checks.ts";

const [outDir, ...inputs] = process.argv.slice(2);
if (!outDir || inputs.length === 0) {
	throw new Error("usage: convert.mts <outDir> <raw*.ndjson.gz>");
}
mkdirSync(`${outDir}/internal`, { recursive: true });
mkdirSync(`${outDir}/send`, { recursive: true });

const checks: InternalClassifierCheck[] = [];
let logRows = 0;
for (const file of inputs) {
	const lines = createInterface({
		input: createReadStream(file).pipe(createGunzip()),
	});
	for await (const line of lines) {
		const row = JSON.parse(line);
		if (row.__total !== undefined) {
			continue;
		}
		logRows++;
		checks.push(
			...internalClassifierChecksFromLog({
				ts: row.ts,
				requestId: row.request_id,
				organizationId: row.organization_id,
				projectId: row.project_id,
				apiKeyId: row.api_key_id,
				usedModel: row.used_model,
				usedProvider: row.used_provider,
				evaluation: row.evaluation,
				response: row.response,
			}),
		);
	}
}
checks.sort((a, b) =>
	a.ts === b.ts ? a.chunkIndex - b.chunkIndex : a.ts < b.ts ? -1 : 1,
);

// What the admin export endpoint returns for this window (real ids).
writeFileSync(
	`${outDir}/internal/export-all.csv`,
	`${[INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS.join(","), ...checks.map(internalClassifierCheckCsvLine)].join("\n")}\n`,
);

// Vendor copy: the vendor audit CSV's columns, request_id dropped, account_id
// pseudonymized (acct-001 = most checks), plus a per-request pseudonym and
// chunk_index. Written directly, not through the admin export's formula guard,
// which rewrites minhash values starting with "+".
const perAccount = new Map<string, number>();
for (const c of checks) {
	perAccount.set(c.organizationId, (perAccount.get(c.organizationId) ?? 0) + 1);
}
const accounts = new Map(
	[...perAccount.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([id], i) => [id, `acct-${String(i + 1).padStart(3, "0")}`]),
);
const requests = new Map<string, string>();
const VENDOR_HEADERS = [
	...INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS.slice(0, 15),
	"account_id",
	"decision",
	"request_key",
	"chunk_index",
];
// RFC 4180 quoting; values are otherwise written verbatim.
const plain = (v: unknown) => {
	const s = v === null || v === undefined ? "" : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Free-text fields (rule, reasons, tags) get a spreadsheet formula guard;
// hashes and base64 stay raw, since a guard would change their value.
const text = (v: string) => (/^[=+@\t\r-]/.test(v) ? `'${v}` : v);
const vendorRows = checks.map((c) => {
	if (!requests.has(c.requestId)) {
		requests.set(c.requestId, `r${String(requests.size + 1).padStart(6, "0")}`);
	}
	return [
		c.ts,
		text(c.rule),
		text(c.reasons.join(";")),
		text(c.tags.join(";")),
		c.score === null ? null : c.score.toFixed(4),
		c.saltId,
		c.algoVersion,
		c.fpStatus,
		c.promptBytes,
		c.simhash,
		c.simhashGlobal,
		c.exactHash,
		c.conversationKey,
		c.minhashB64,
		c.bandKeys?.join(";"),
		accounts.get(c.organizationId),
		c.decision,
		requests.get(c.requestId),
		c.chunkIndex,
	]
		.map(plain)
		.join(",");
});
writeFileSync(
	`${outDir}/send/checks.csv`,
	`${[VENDOR_HEADERS.join(","), ...vendorRows].join("\n")}\n`,
);
writeFileSync(
	`${outDir}/internal/account-pseudonyms.csv`,
	`${["account_pseudonym,organization_id,checks", ...[...accounts.entries()].map(([id, p]) => `${p},${id},${perAccount.get(id)}`)].join("\n")}\n`,
);

// Per rule: blocks, share, accounts, median prompt size, top tags.
const blocks = checks.filter((c) => c.decision === "block");
const byRule = new Map<string, InternalClassifierCheck[]>();
for (const c of blocks) {
	byRule.set(c.rule, [...(byRule.get(c.rule) ?? []), c]);
}
// Prompt size comes from the fingerprint; empty when no row has one.
const median = (values: number[]) => {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return Math.round(
		sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2,
	);
};
const ruleRows = [...byRule.entries()]
	.sort((a, b) => b[1].length - a[1].length)
	.map(([rule, rows]) => {
		const tagCounts = new Map<string, number>();
		for (const c of rows) {
			for (const tag of c.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}
		const topTags = [...tagCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4)
			.map(([tag]) => tag);
		return [
			text(rule),
			rows.length,
			(rows.length / blocks.length).toFixed(3),
			new Set(rows.map((c) => c.organizationId)).size,
			median(
				rows.flatMap((c) => (c.promptBytes === null ? [] : [c.promptBytes])),
			),
			text(topTags.join(";")),
		]
			.map(plain)
			.join(",");
	});
writeFileSync(
	`${outDir}/send/rule-summary.csv`,
	`${["rule,blocks,share,accounts,median_prompt_bytes,top_tags", ...ruleRows].join("\n")}\n`,
);

const hours = new Map<string, [number, number]>();
for (const c of checks) {
	const hour = `${c.ts.slice(0, 13)}:00Z`;
	const [all, blocked] = hours.get(hour) ?? [0, 0];
	hours.set(hour, [all + 1, blocked + (c.decision === "block" ? 1 : 0)]);
}
const hourRows = [...hours.entries()]
	.sort((a, b) => (a[0] < b[0] ? -1 : 1))
	.map(([hour, [all, blocked]]) => `${hour},${all},${blocked}`);
writeFileSync(
	`${outDir}/send/hourly.csv`,
	`${["hour_utc,checks,blocks", ...hourRows].join("\n")}\n`,
);

console.log(
	JSON.stringify({
		logRows,
		checks: checks.length,
		requests: requests.size,
		accounts: accounts.size,
		blocks: blocks.length,
		passesWithReasons: checks.filter(
			(c) => c.decision !== "block" && c.reasons.length > 0,
		).length,
		withFingerprint: checks.filter((c) => c.saltId !== null).length,
		tooShort: checks.filter((c) => c.fpStatus === "too_short").length,
	}),
);
