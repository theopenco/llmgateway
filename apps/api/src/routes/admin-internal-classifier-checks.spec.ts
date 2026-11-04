import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import { INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS } from "./admin-internal-classifier-checks.js";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
const BASE = new Date("2026-10-20T12:00:00.000Z");
const MINUTE_MS = 60_000;
const DAY_AND_HOUR_MS = 25 * 3_600_000;

const FINGERPRINT = {
	salt_id: "default",
	algo_version: 1,
	fp_status: "ok",
	prompt_bytes: 113,
	simhash: "-121594583441436065",
	simhash_global: "-2619368671083822859",
	exact_hash: "-4277168721033277467",
	conversation_key: "c_65f685b18ecceb9c",
	minhash_b64: "5KR9+jFd/w==",
	band_keys: ["-4189572804323252917", "7653213509540500479"],
};

// A content-filtered log row whose internal classifier returned one verdict.
function check(minutes: number, decision: "allow" | "block", id: string) {
	const offsetMs = minutes * MINUTE_MS;
	const block = decision === "block";
	return {
		id,
		createdAt: new Date(BASE.getTime() + offsetMs),
		requestId: `req-${id}`,
		organizationId: "org-1",
		projectId: "project-1",
		apiKeyId: "key-1",
		duration: 100,
		requestedModel: "gpt-4o-mini",
		usedModel: "openai/gpt-4o-mini",
		usedProvider: "openai",
		responseSize: 0,
		mode: "credits" as const,
		usedMode: "credits" as const,
		gatewayContentFilterEvaluation: {
			sampled: true as const,
			provider: "openai",
			tier: 2,
			overridden: false,
			level: "strict" as const,
			violation: block,
			action: block ? ("logged" as const) : ("passed" as const),
			enforced: false,
			flagged: block,
			matchedCategories: [],
			categoryScores: {},
			moderationFailed: false,
			classifier: "internal" as const,
			internalScope: "latest_turn" as const,
		},
		gatewayContentFilterResponse: [
			{
				model: "internal-classifier",
				results: [
					{
						flagged: block,
						block,
						decision,
						...(block
							? {
									rule: "minor_plus_sexual_conjunction",
									reasons: [
										"minor_plus_sexual_conjunction",
										"signal:minor_age",
									],
								}
							: {}),
						tags: block ? ["child_exploitation", "sexual_content"] : [],
						score: block ? 0.9 : 0,
						fingerprint: FINGERPRINT,
					},
				],
			},
		],
	};
}

function exportUrl(query: Record<string, string>) {
	return `/admin/content-filter/internal-checks/export?${new URLSearchParams(query)}`;
}

describe("admin internal classifier check export", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db
			.insert(tables.log)
			.values([
				check(1, "allow", "a"),
				check(2, "block", "b"),
				check(3, "allow", "c"),
				check(-5, "block", "before"),
				check(70, "block", "after"),
			]);
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		} else {
			process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	const window = {
		from: BASE.toISOString(),
		to: new Date(BASE.getTime() + 3_600_000).toISOString(),
	};

	test("exports every check in the window in the audit CSV's column order", async () => {
		const res = await app.request(exportUrl(window), {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		const lines = (await res.text()).trimEnd().split("\n");
		expect(lines[0]).toBe(INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS.join(","));
		expect(lines.slice(1).map((line) => line.split(",")[15])).toEqual([
			"req-a",
			"req-b",
			"req-c",
		]);
		expect(lines[2]).toBe(
			[
				"2026-10-20T12:02:00.000000Z",
				"minor_plus_sexual_conjunction",
				"minor_plus_sexual_conjunction;signal:minor_age",
				"child_exploitation;sexual_content",
				"0.9000",
				"default",
				"1",
				"ok",
				"113",
				"-121594583441436065",
				"-2619368671083822859",
				"-4277168721033277467",
				"c_65f685b18ecceb9c",
				"5KR9+jFd/w==",
				"-4189572804323252917;7653213509540500479",
				"req-b",
				"org-1",
				"block",
				"project-1",
				"key-1",
				"openai/gpt-4o-mini",
				"openai",
				"0",
				"latest_turn",
				"2",
				"strict",
				"logged",
			].join(","),
		);
	});

	test("exports only blocks when asked", async () => {
		const res = await app.request(exportUrl({ ...window, decision: "block" }), {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		const lines = (await res.text()).trimEnd().split("\n");
		expect(lines.slice(1).map((line) => line.split(",")[15])).toEqual([
			"req-b",
		]);
	});

	test("pages through rows that share a timestamp without gaps or repeats", async () => {
		// Several pages of 2000, most rows on one microsecond.
		const tied = Array.from({ length: 10_001 }, (_, i) => ({
			...check(10, "allow", `tied-${String(i).padStart(5, "0")}`),
			createdAt: new Date(BASE.getTime() + (i < 7_000 ? 600_000 : 660_000)),
		}));
		for (let i = 0; i < tied.length; i += 2_000) {
			await db.insert(tables.log).values(tied.slice(i, i + 2_000));
		}

		const res = await app.request(exportUrl(window), {
			headers: { Cookie: cookie },
		});

		const requestIds = (await res.text())
			.trimEnd()
			.split("\n")
			.slice(1)
			.map((line) => line.split(",")[15]);
		expect(requestIds).toHaveLength(10_004);
		expect(new Set(requestIds).size).toBe(10_004);
	});

	test("neutralizes formula triggers but keeps negative hashes", async () => {
		await db
			.insert(tables.log)
			.values({ ...check(30, "allow", "formula"), requestId: "=HYPERLINK(1)" });

		const res = await app.request(exportUrl(window), {
			headers: { Cookie: cookie },
		});

		const line = (await res.text())
			.split("\n")
			.find((l) => l.includes("HYPERLINK"));
		expect(line?.split(",")[15]).toBe("'=HYPERLINK(1)");
		expect(line?.split(",")[9]).toBe("-121594583441436065");
	});

	test("skips retried attempts and logs without a content filter response", async () => {
		await db.insert(tables.log).values([
			{ ...check(20, "block", "retried"), retried: true },
			{
				...check(21, "allow", "unfiltered"),
				gatewayContentFilterEvaluation: null,
				gatewayContentFilterResponse: null,
			},
		]);

		const res = await app.request(exportUrl(window), {
			headers: { Cookie: cookie },
		});

		const text = await res.text();
		expect(text).not.toContain("req-retried");
		expect(text).not.toContain("req-unfiltered");
	});

	test("rejects a full export longer than a day", async () => {
		const res = await app.request(
			exportUrl({
				from: BASE.toISOString(),
				to: new Date(BASE.getTime() + DAY_AND_HOUR_MS).toISOString(),
			}),
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(400);
	});

	test("requires an admin", async () => {
		delete process.env.ADMIN_FULL_ACCESS_EMAILS;
		const res = await app.request(exportUrl(window), {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(403);
	});
});
