/* eslint-disable no-console */
/**
 * One-off: add every contact opted in to the newsletter topic to the segment
 * newsletter broadcasts are addressed to. Signups made before the newsletter
 * had a segment are in none, and a broadcast only reaches contacts in its
 * segment. Addresses that turned marketing email off in the app are left out.
 *
 * Usage:
 *   # count who would be added
 *   RESEND_API_KEY=re_xxx RESEND_NEWSLETTER_TOPIC_ID=... RESEND_NEWSLETTER_SEGMENT_ID=... \
 *     DATABASE_URL=... pnpm --filter @llmgateway/scripts newsletter-segment-backfill
 *
 *   # add them
 *   ... pnpm --filter @llmgateway/scripts newsletter-segment-backfill --apply
 *
 * Flags:
 *   --apply                   Write. Refuses a local database or one with no
 *                             marketing unsubscribes on file.
 *   --allow-local-database    Production reached through a local tunnel.
 *
 * Environment (all required):
 *   RESEND_API_KEY, RESEND_NEWSLETTER_TOPIC_ID, RESEND_NEWSLETTER_SEGMENT_ID
 *   DATABASE_URL   The production database, read for marketing unsubscribes.
 */

import { setTimeout as sleep } from "timers/promises";

import { db, eq, isEmailSuppressed, sql, tables } from "@llmgateway/db";
import { resendFetch } from "@llmgateway/shared/resend-api";

import {
	assertSafeToApply,
	backfillSegment,
	withRateLimitRetry,
} from "./newsletter-segment-backfill-lib.js";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

async function main() {
	const apiKey = requireEnv("RESEND_API_KEY");
	const topicId = requireEnv("RESEND_NEWSLETTER_TOPIC_ID");
	const segmentId = requireEnv("RESEND_NEWSLETTER_SEGMENT_ID");
	const databaseHost = new URL(requireEnv("DATABASE_URL")).hostname;
	const apply = process.argv.includes("--apply");

	const [{ count: suppressionsOnFile }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(tables.emailUnsubscribe)
		.where(eq(tables.emailUnsubscribe.category, "marketing"));
	console.log(
		`Database ${databaseHost}: ${suppressionsOnFile} marketing unsubscribes on file`,
	);
	if (apply) {
		assertSafeToApply({
			databaseHost,
			suppressionsOnFile,
			allowLocalDatabase: process.argv.includes("--allow-local-database"),
		});
	}

	const result = await backfillSegment({
		request: withRateLimitRetry(
			async (method, path) => await resendFetch({ apiKey, method, path }),
			async (ms) => {
				await sleep(ms);
			},
		),
		isSuppressed: async (email) => await isEmailSuppressed(email, "marketing"),
		topicId,
		segmentId,
		apply,
	});

	console.log(`Contacts scanned:             ${result.scanned}`);
	console.log(`Already in the segment:       ${result.alreadyInSegment}`);
	console.log(`Unsubscribed from everything: ${result.unsubscribed}`);
	console.log(`Not opted in to the topic:    ${result.notOptedIn}`);
	console.log(`Marketing email turned off:   ${result.suppressed}`);
	console.log(`Opted in, not in the segment: ${result.toAdd}`);
	console.log(
		apply
			? `Added to the segment:         ${result.added}`
			: "Dry run: pass --apply to add them.",
	);
}

void main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
