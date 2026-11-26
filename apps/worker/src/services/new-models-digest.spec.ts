import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";

import { dueIssueDay, processNewModelsDigest } from "./new-models-digest.js";

// Ways the weekly job can go wrong: Resend rejects the draft (its name allows
// 70 characters, which a subject made of model names passes); every hourly
// tick saves the same draft again; a run before Monday's hour, or a late one,
// covers the wrong week; a week with nothing new still produces a draft; a
// failed catalogue read is recorded as a quiet week and the issue is lost; or
// a deployment without the topic drafts to contacts who opted out.

// The Monday of the run that failed: its issue covers Nov 9 to Nov 15.
const monday = new Date("2026-11-16T17:00:00Z");
const RESEND_NAME_LIMIT = 70;

let changelogDir: string;
let catalogue: unknown[];
let catalogueStatus: number;
let broadcasts: Array<Record<string, string>>;
let requests: string[];

function landed(id: string, createdAt: string) {
	return {
		id,
		name: `${id} with a very long display name for the subject line`,
		description: "A model.",
		createdAt,
		releasedAt: null,
		status: "active",
		mappings: [
			{
				providerId: "alpha",
				inputPrice: "0.000001",
				outputPrice: "0.000002",
				contextSize: 200000,
				deactivatedAt: null,
				status: "active",
			},
		],
	};
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(async () => {
	await db.delete(tables.newsletterIssue);
	changelogDir = await mkdtemp(join(tmpdir(), "digest-changelog-"));
	await writeFile(
		join(changelogDir, "2026-11-10-shipped.md"),
		'---\nslug: "shipped"\ntitle: "Shipped"\nsummary: "It shipped."\ndate: "2026-11-10"\n---\n\nBody\n',
	);
	catalogue = [
		landed("model-one", "2026-11-12T10:00:00Z"),
		landed("model-two", "2026-11-13T10:00:00Z"),
		landed("model-three", "2026-11-14T10:00:00Z"),
		landed("this-week", "2026-11-16T09:00:00Z"),
	];
	catalogueStatus = 200;
	broadcasts = [];
	requests = [];
	vi.stubEnv("RESEND_API_KEY", ["re", "test"].join("_"));
	vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "segment-1");
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "topic-1");
	vi.stubEnv("DISCORD_NEWSLETTER_NOTIFICATION_URL", "");
	vi.stubEnv("API_BACKEND_URL", "http://api.test");
	vi.stubEnv("CHANGELOG_DIR", changelogDir);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			requests.push(url);
			if (url === "http://api.test/internal/models") {
				return json({ models: catalogue }, catalogueStatus);
			}
			if (url === "http://api.test/internal/providers") {
				return json({ providers: [{ id: "alpha", name: "Alpha Cloud" }] });
			}
			if (url === "https://api.resend.com/broadcasts") {
				const body = JSON.parse(String(init?.body)) as Record<string, string>;
				if (body.name.length > RESEND_NAME_LIMIT) {
					return json({ message: "Field 'name' is too long." }, 422);
				}
				broadcasts.push(body);
				return json({ id: `broadcast-${broadcasts.length}` });
			}
			throw new Error(`Unexpected request to ${url}`);
		}),
	);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(changelogDir, { recursive: true, force: true });
});

test("an issue is due from Monday 07:00 UTC until the next one is", () => {
	const day = (iso: string) => dueIssueDay(new Date(iso)).toISOString();

	expect(day("2026-11-16T06:59:59Z")).toBe("2026-11-09T00:00:00.000Z");
	expect(day("2026-11-16T07:00:00Z")).toBe("2026-11-16T00:00:00.000Z");
	expect(day("2026-11-22T23:59:59Z")).toBe("2026-11-16T00:00:00.000Z");
	expect(day("2026-11-23T07:00:00Z")).toBe("2026-11-23T00:00:00.000Z");
});

test("saves last week's issue as one draft, however often it runs", async () => {
	await processNewModelsDigest(monday);
	await processNewModelsDigest(new Date("2026-11-16T18:00:00Z"));
	await processNewModelsDigest(new Date("2026-11-20T03:00:00Z"));

	expect(broadcasts).toHaveLength(1);
	const [draft] = broadcasts;
	expect(draft.name).toBe("New models: 2026-11-09 to 2026-11-15");
	expect(draft.subject.length).toBeGreaterThan(RESEND_NAME_LIMIT);
	expect(draft).toMatchObject({ segment_id: "segment-1", topic_id: "topic-1" });
	expect(draft).not.toHaveProperty("send");
	expect(draft).not.toHaveProperty("scheduled_at");
	expect(draft.text).toContain("model-three");
	expect(draft.text).toContain("Alpha Cloud");
	expect(draft.text).toContain("Shipped");
	expect(draft.text).not.toContain("this-week");
	expect(await db.select().from(tables.newsletterIssue)).toMatchObject([
		{ id: "new-models:2026-11-16", broadcastId: "broadcast-1" },
	]);
});

test("the next Monday gets its own issue", async () => {
	await processNewModelsDigest(monday);
	await processNewModelsDigest(new Date("2026-11-23T07:05:00Z"));

	expect(broadcasts.map((draft) => draft.name)).toEqual([
		"New models: 2026-11-09 to 2026-11-15",
		"New models: 2026-11-16 to 2026-11-22",
	]);
	expect(broadcasts[1].text).toContain("this-week");
});

test("a week with nothing new is settled without a draft", async () => {
	catalogue = [landed("old", "2026-10-01T10:00:00Z")];

	await processNewModelsDigest(monday);
	const afterFirst = requests.length;
	await processNewModelsDigest(monday);

	expect(broadcasts).toHaveLength(0);
	expect(requests).toHaveLength(afterFirst);
	expect(await db.select().from(tables.newsletterIssue)).toMatchObject([
		{ id: "new-models:2026-11-16", broadcastId: null },
	]);
});

test("a failed catalogue read leaves the issue due", async () => {
	catalogueStatus = 503;
	await expect(processNewModelsDigest(monday)).rejects.toThrow(
		"Failed to load models: 503",
	);
	expect(await db.select().from(tables.newsletterIssue)).toHaveLength(0);

	catalogueStatus = 200;
	await processNewModelsDigest(monday);

	expect(broadcasts).toHaveLength(1);
});

test("does nothing without the topic that honours opt-outs", async () => {
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "");

	await processNewModelsDigest(monday);

	expect(requests).toHaveLength(0);
});
