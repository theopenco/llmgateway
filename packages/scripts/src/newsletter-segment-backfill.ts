/* eslint-disable no-console */
/**
 * One-off: add every contact opted in to the newsletter topic to the segment
 * newsletter broadcasts are addressed to. Signups made before the newsletter
 * had a segment are in none, and a broadcast only reaches contacts in its
 * segment. Addresses that unsubscribed from marketing email in the app are
 * left out.
 *
 * Usage:
 *   # count who would be added
 *   RESEND_API_KEY=re_xxx RESEND_NEWSLETTER_TOPIC_ID=... RESEND_NEWSLETTER_SEGMENT_ID=... \
 *     DATABASE_URL=... pnpm --filter @llmgateway/scripts newsletter-segment-backfill
 *
 *   # add them
 *   ... pnpm --filter @llmgateway/scripts newsletter-segment-backfill --apply
 *
 * Environment:
 *   RESEND_API_KEY, RESEND_NEWSLETTER_TOPIC_ID, RESEND_NEWSLETTER_SEGMENT_ID   Required.
 *   DATABASE_URL   The app database, read for marketing unsubscribes.
 */

import { setTimeout as sleep } from "timers/promises";

import { isEmailSuppressed } from "@llmgateway/db";
import { resendFetch } from "@llmgateway/shared/resend-api";

import {
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
	const apply = process.argv.includes("--apply");
	const result = await backfillSegment({
		request: withRateLimitRetry(
			async (method, path) => await resendFetch({ apiKey, method, path }),
			async (ms) => {
				await sleep(ms);
			},
		),
		isSuppressed: async (email) => await isEmailSuppressed(email, "marketing"),
		topicId: requireEnv("RESEND_NEWSLETTER_TOPIC_ID"),
		segmentId: requireEnv("RESEND_NEWSLETTER_SEGMENT_ID"),
		apply,
	});

	console.log(`Contacts scanned:            ${result.scanned}`);
	console.log(`Already in the segment:      ${result.alreadyInSegment}`);
	console.log(`Unsubscribed:                ${result.unsubscribed}`);
	console.log(`Not opted in to the topic:   ${result.notOptedIn}`);
	console.log(`Marketing email turned off:  ${result.suppressed}`);
	console.log(`Opted in, not in the segment: ${result.toAdd}`);
	console.log(
		apply
			? `Added to the segment:        ${result.added}`
			: "Dry run: pass --apply to add them.",
	);
}

void main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
