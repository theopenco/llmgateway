/* eslint-disable no-console */
/**
 * Build the weekly "new models" newsletter issue from the live catalogue (the
 * endpoints the site reads, so provider-listed models are included) and the
 * changelog, and optionally save it in Resend as a broadcast draft. The script
 * never sends: a person reviews the draft and sends it from Resend.
 *
 * The issue covers the whole UTC days before the day it runs (or before
 * `--until`), so a run on Monday covers the previous Monday to Sunday at any
 * hour.
 *
 * Usage:
 *   # write the issue to new-models-digest.html / .txt and print a summary
 *   pnpm --filter @llmgateway/scripts new-models-digest
 *
 *   # also create the draft in Resend
 *   RESEND_API_KEY=re_xxx RESEND_NEWSLETTER_SEGMENT_ID=... RESEND_NEWSLETTER_TOPIC_ID=... \
 *     pnpm --filter @llmgateway/scripts new-models-digest --create-draft
 *
 * Flags:
 *   --days=7          Days the issue covers (default 7).
 *   --until=YYYY-MM-DD  First day the issue does not cover (default today, UTC).
 *                     For a run that is late: pass the day it should have run.
 *   --out=path        File prefix for the rendered issue (default new-models-digest).
 *   --api-url=url     API to read the catalogue from (default https://internal.llmgateway.io).
 *   --create-draft    Create a Resend broadcast draft from the issue.
 *
 * Environment (only for --create-draft):
 *   RESEND_API_KEY                 Required.
 *   RESEND_NEWSLETTER_SEGMENT_ID   Required. The segment newsletter signups are added to.
 *   RESEND_NEWSLETTER_TOPIC_ID     Required. Keeps the issue from contacts who opted out.
 *   DISCORD_NEWSLETTER_NOTIFICATION_URL   Optional. Gets a note that a draft is waiting.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { POSTAL_ADDRESS } from "@llmgateway/shared/email-unsubscribe";
import { resendFetch } from "@llmgateway/shared/resend-api";

import {
	buildBroadcastDraft,
	buildDigest,
	fromCatalogue,
	parseChangelogEntry,
	readCatalogueList,
	type CatalogueModel,
	type Digest,
	type DigestChangelogInput,
} from "./new-models-digest-lib.js";

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_API_URL = "https://internal.llmgateway.io";
const CHANGELOG_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../apps/ui/src/content/changelog",
);

function getArg(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg?.slice(flag.length);
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function readChangelog(): DigestChangelogInput[] {
	return readdirSync(CHANGELOG_DIR)
		.filter((file) => file.endsWith(".md"))
		.map((file) =>
			parseChangelogEntry(readFileSync(join(CHANGELOG_DIR, file), "utf8"), file),
		);
}

async function fetchCatalogue<T>(
	apiUrl: string,
	resource: "models" | "providers",
): Promise<T[]> {
	const response = await fetch(`${apiUrl}/internal/${resource}`, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`Failed to load ${resource}: ${response.status}`);
	}
	return readCatalogueList<T>(await response.json(), resource);
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required to create the draft`);
	}
	return value;
}

async function createDraft(digest: Digest): Promise<string> {
	const response = await resendFetch({
		apiKey: requireEnv("RESEND_API_KEY"),
		method: "POST",
		path: "/broadcasts",
		body: buildBroadcastDraft(digest, {
			segmentId: requireEnv("RESEND_NEWSLETTER_SEGMENT_ID"),
			topicId: requireEnv("RESEND_NEWSLETTER_TOPIC_ID"),
		}),
		timeoutMs: REQUEST_TIMEOUT_MS,
	});
	if (!response.ok) {
		throw new Error(
			`Resend error: ${response.status} - ${await response.text()}`,
		);
	}
	const body = (await response.json()) as { id: string };
	return body.id;
}

async function notify(subject: string, modelCount: number): Promise<void> {
	const url = process.env.DISCORD_NEWSLETTER_NOTIFICATION_URL;
	if (!url) {
		return;
	}
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			content: `Newsletter draft waiting in Resend: "${subject}" (${modelCount} new ${modelCount === 1 ? "model" : "models"}). Review it and send.`,
			allowed_mentions: { parse: [] },
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`Discord webhook error: ${response.status} - ${await response.text()}`,
		);
	}
}

async function main() {
	const days = Number(getArg("days") ?? "7");
	if (!Number.isInteger(days) || days < 1) {
		throw new Error("--days must be a positive whole number");
	}
	const now = new Date();
	const untilArg = getArg("until");
	if (untilArg !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(untilArg)) {
		throw new Error("--until must be a date like 2026-11-16");
	}
	const until = untilArg ? new Date(`${untilArg}T00:00:00Z`) : now;
	if (Number.isNaN(until.getTime()) || until > now) {
		throw new Error("--until must be a real date that is not in the future");
	}
	const apiUrl = getArg("api-url") ?? DEFAULT_API_URL;
	const [models, providers] = await Promise.all([
		fetchCatalogue<CatalogueModel>(apiUrl, "models"),
		fetchCatalogue<{ id: string; name: string | null }>(apiUrl, "providers"),
	]);
	const digest = buildDigest({
		models: fromCatalogue(models),
		providerNames: new Map(
			providers.map((provider) => [provider.id, provider.name ?? provider.id]),
		),
		changelog: readChangelog(),
		now,
		days,
		until,
		postalAddress: POSTAL_ADDRESS,
	});
	if (!digest) {
		console.log(
			`No models landed in the ${days} days before ${until.toISOString().slice(0, 10)}. Nothing to send.`,
		);
		return;
	}

	const out = getArg("out") ?? "new-models-digest";
	writeFileSync(`${out}.html`, digest.html);
	writeFileSync(`${out}.txt`, digest.text);
	console.log(`Subject: ${digest.subject}`);
	console.log(
		`${digest.models.length} models, ${digest.changelog.length} changelog entries`,
	);
	for (const model of digest.models) {
		console.log(`  - ${model.name} (${model.providers.join(", ")})`);
	}
	console.log(`Wrote ${out}.html and ${out}.txt`);

	if (!hasFlag("create-draft")) {
		console.log("Dry run: pass --create-draft to save it in Resend.");
		return;
	}
	const id = await createDraft(digest);
	console.log(`Created Resend broadcast draft ${id}. Review and send it there.`);
	await notify(digest.subject, digest.models.length);
}

void main();
