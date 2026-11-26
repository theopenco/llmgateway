import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
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
} from "./new-models-digest-content.js";

const HOUR_MS = 3_600_000;
const REQUEST_TIMEOUT_MS = 30_000;
const LOOP_INTERVAL_MS = HOUR_MS;
const ISSUE_DAYS = 7;
/** An issue is due on Monday at this hour, UTC. */
const DUE_HOUR_UTC = 7;
const DUE_OFFSET_MS = DUE_HOUR_UTC * HOUR_MS;
const NEW_MODELS_DIGEST_LOCK_KEY = "new_models_digest";
const DEFAULT_API_URL = "https://internal.llmgateway.io";
// The worker image carries the changelog at CHANGELOG_DIR; a checkout has it
// in the UI app.
const DEFAULT_CHANGELOG_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../ui/src/content/changelog",
);

interface NewsletterConfig {
	apiKey: string;
	segmentId: string;
	topicId: string;
}

/**
 * Null unless all three are set. The topic is not optional: without it Resend
 * ignores topic preferences and reaches contacts who opted out.
 */
function newsletterConfig(): NewsletterConfig | null {
	const apiKey = process.env.RESEND_API_KEY;
	const segmentId = process.env.RESEND_NEWSLETTER_SEGMENT_ID;
	const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
	return apiKey && segmentId && topicId ? { apiKey, segmentId, topicId } : null;
}

/**
 * The first day the due issue does not cover: the latest Monday that has
 * reached the due hour. An issue missed while the worker was down is still due
 * until the next one is.
 */
export function dueIssueDay(now: Date): Date {
	const shifted = new Date(now.getTime() - DUE_OFFSET_MS);
	const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
	return new Date(
		Date.UTC(
			shifted.getUTCFullYear(),
			shifted.getUTCMonth(),
			shifted.getUTCDate() - daysSinceMonday,
		),
	);
}

/**
 * The catalogue as the site shows it, from the endpoints the site reads, so
 * provider-listed models and their public names are included.
 */
async function fetchCatalogue<T>(
	resource: "models" | "providers",
): Promise<T[]> {
	const apiUrl =
		process.env.API_BACKEND_URL ?? process.env.API_URL ?? DEFAULT_API_URL;
	const response = await fetch(`${apiUrl}/internal/${resource}`, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`Failed to load ${resource}: ${response.status}`);
	}
	return readCatalogueList<T>(await response.json(), resource);
}

async function readChangelog(): Promise<DigestChangelogInput[]> {
	const dir = process.env.CHANGELOG_DIR ?? DEFAULT_CHANGELOG_DIR;
	const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
	return await Promise.all(
		files.map(async (file) =>
			parseChangelogEntry(await readFile(join(dir, file), "utf8"), file),
		),
	);
}

async function createDraft(
	digest: Digest,
	config: NewsletterConfig,
): Promise<string> {
	const response = await resendFetch({
		apiKey: config.apiKey,
		method: "POST",
		path: "/broadcasts",
		body: buildBroadcastDraft(digest, config),
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

async function notify(digest: Digest): Promise<void> {
	const url = process.env.DISCORD_NEWSLETTER_NOTIFICATION_URL;
	if (!url) {
		return;
	}
	const count = digest.models.length;
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			content: `Newsletter draft waiting in Resend: "${digest.subject}" (${count} new ${count === 1 ? "model" : "models"}). Review it and send.`,
			allowed_mentions: { parse: [] },
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`Discord webhook error: ${response.status}`);
	}
}

/**
 * Saves the due weekly "new models" issue in Resend as a broadcast draft, once.
 * It never sends: a person reviews the draft and sends it from Resend.
 */
export async function processNewModelsDigest(now = new Date()): Promise<void> {
	const config = newsletterConfig();
	if (!config) {
		return;
	}
	const until = dueIssueDay(now);
	const id = `new-models:${until.toISOString().slice(0, 10)}`;
	const handled = await db
		.select({ id: tables.newsletterIssue.id })
		.from(tables.newsletterIssue)
		.where(eq(tables.newsletterIssue.id, id))
		.limit(1);
	if (handled.length > 0) {
		return;
	}

	const [models, providers, changelog] = await Promise.all([
		fetchCatalogue<CatalogueModel>("models"),
		fetchCatalogue<{ id: string; name: string | null }>("providers"),
		readChangelog(),
	]);
	const digest = buildDigest({
		models: fromCatalogue(models),
		providerNames: new Map(
			providers.map((provider) => [provider.id, provider.name ?? provider.id]),
		),
		changelog,
		now,
		days: ISSUE_DAYS,
		until,
		postalAddress: POSTAL_ADDRESS,
	});
	const broadcastId = digest ? await createDraft(digest, config) : null;
	// Recorded after the draft exists: a crash in between repeats a draft a
	// person reviews anyway, where the other order would skip the week.
	await db
		.insert(tables.newsletterIssue)
		.values({ id, broadcastId })
		.onConflictDoNothing();
	if (!digest) {
		logger.info("No new models for the weekly issue; nothing drafted", { id });
		return;
	}
	logger.info("Created the weekly new-models broadcast draft", {
		id,
		broadcastId,
		name: digest.name,
		models: digest.models.length,
	});
	try {
		await notify(digest);
	} catch (error) {
		logger.error(
			"The new-models draft is saved, but the Discord note failed",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

export async function runNewModelsDigestLoop(deps: {
	shouldStop: () => boolean;
	acquireLock: (key: string) => Promise<boolean>;
	releaseLock: (key: string) => Promise<void>;
	interruptibleSleep: (ms: number) => Promise<void>;
	registerLoop: () => void;
	unregisterLoop: () => void;
}): Promise<void> {
	if (!newsletterConfig()) {
		logger.info(
			"New-models digest loop not started: the Resend newsletter variables are not set",
		);
		return;
	}
	deps.registerLoop();
	logger.info("Starting new-models digest loop...");

	try {
		while (!deps.shouldStop()) {
			try {
				if (await deps.acquireLock(NEW_MODELS_DIGEST_LOCK_KEY)) {
					try {
						await processNewModelsDigest();
					} finally {
						await deps.releaseLock(NEW_MODELS_DIGEST_LOCK_KEY);
					}
				}
			} catch (error) {
				logger.error(
					"Error in new-models digest loop",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
			if (!deps.shouldStop()) {
				await deps.interruptibleSleep(LOOP_INTERVAL_MS);
			}
		}
	} finally {
		deps.unregisterLoop();
		logger.info("New-models digest loop stopped");
	}
}
