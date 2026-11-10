/* eslint-disable no-console */
/**
 * Build the weekly "new models" newsletter issue from the live catalogue (the
 * endpoint the site reads, so provider-listed models are included) and the
 * changelog, and optionally save it in Resend as a broadcast draft. The script
 * never sends: a person reviews the draft and sends it from Resend.
 *
 * Usage:
 *   # write the issue to new-models-digest.html / .txt and print a summary
 *   pnpm --filter @llmgateway/scripts new-models-digest
 *
 *   # also create the draft in Resend
 *   RESEND_API_KEY=re_xxx RESEND_NEWSLETTER_SEGMENT_ID=... \
 *     pnpm --filter @llmgateway/scripts new-models-digest --create-draft
 *
 * Flags:
 *   --days=7          Window of releases to include (default 7).
 *   --out=path        File prefix for the rendered issue (default new-models-digest).
 *   --api-url=url     API to read the catalogue from (default https://internal.llmgateway.io).
 *   --create-draft    Create a Resend broadcast draft from the issue.
 *
 * Environment (only for --create-draft):
 *   RESEND_API_KEY                 Required.
 *   RESEND_NEWSLETTER_SEGMENT_ID   Required. The segment newsletter signups are added to.
 *   RESEND_NEWSLETTER_TOPIC_ID     Optional. Applies that topic's subscription preferences.
 *   DISCORD_NEWSLETTER_NOTIFICATION_URL   Optional. Gets a note that a draft is waiting.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { POSTAL_ADDRESS } from "@llmgateway/shared/email-unsubscribe";
import { resendFetch } from "@llmgateway/shared/resend-api";

import {
	buildDigest,
	fromCatalogue,
	type CatalogueModel,
	type DigestChangelogInput,
} from "./new-models-digest-lib.js";

const FROM = "LLM Gateway <contact@mail.llmgateway.io>";
const REPLY_TO = "contact@llmgateway.io";
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

function frontmatterValue(source: string, key: string): string | undefined {
	const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(source);
	if (!match) {
		return undefined;
	}
	const raw = match[1].trim();
	return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
}

function readChangelog(): DigestChangelogInput[] {
	const entries: DigestChangelogInput[] = [];
	for (const file of readdirSync(CHANGELOG_DIR)) {
		if (!file.endsWith(".md")) {
			continue;
		}
		const source = readFileSync(join(CHANGELOG_DIR, file), "utf8");
		const frontmatter = source.split("\n---")[0];
		const slug = frontmatterValue(frontmatter, "slug");
		const title = frontmatterValue(frontmatter, "title");
		const summary = frontmatterValue(frontmatter, "summary");
		const date = frontmatterValue(frontmatter, "date");
		if (!slug || !title || !summary || !date) {
			throw new Error(`Changelog entry ${file} is missing frontmatter`);
		}
		entries.push({
			slug,
			title,
			summary,
			date,
			draft: frontmatterValue(frontmatter, "draft") === "true",
		});
	}
	return entries;
}

/** An empty list is a failed read, never a quiet week. */
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
	const body = (await response.json()) as Record<string, T[] | undefined>;
	const items = body[resource];
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error(`The API returned no ${resource}`);
	}
	return items;
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required to create the draft`);
	}
	return value;
}

async function createDraft(digest: {
	subject: string;
	previewText: string;
	html: string;
	text: string;
}): Promise<string> {
	const response = await resendFetch({
		apiKey: requireEnv("RESEND_API_KEY"),
		method: "POST",
		path: "/broadcasts",
		body: {
			segment_id: requireEnv("RESEND_NEWSLETTER_SEGMENT_ID"),
			topic_id: process.env.RESEND_NEWSLETTER_TOPIC_ID || undefined,
			from: FROM,
			reply_to: REPLY_TO,
			name: digest.subject,
			subject: digest.subject,
			preview_text: digest.previewText,
			html: digest.html,
			text: digest.text,
		},
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
		now: new Date(),
		days,
		postalAddress: POSTAL_ADDRESS,
	});
	if (!digest) {
		console.log(`No models released in the last ${days} days. Nothing to send.`);
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
