/* eslint-disable no-console */
/**
 * Remove Resend contacts that cannot or should not get a broadcast, so the
 * stored contact list holds only people a broadcast can reach. Four groups:
 *
 *   suppressed        the address is on Resend's suppression list
 *   no-account        no account has the address
 *   refused-account   the account is deactivated, risk-flagged or unverified
 *   duplicate         an extra copy of an address that keeps one contact
 *
 * Never removed: a contact that unsubscribed (the opt-out lives on it), a
 * member of the newsletter segment, and anyone opted in to the newsletter
 * topic. Other segments protect nobody: they are lists made for a past notice.
 * Without --apply it only counts.
 *
 * Each candidate gets a last look right before its delete: its newsletter
 * opt-in and its unsubscribe are read again, and either keeps it. For the two
 * account groups its account is read again too, and a reachable one keeps it.
 * A duplicate is kept when the copy it duplicates is gone by then. A delete
 * cannot be undone and the script keeps no record of it, so export the
 * contacts first if you may want them back.
 *
 * It lists every contact, newsletter member and suppression, then makes two
 * calls per candidate (three for a duplicate, plus a database read for the two
 * account groups) and one more per delete, at most five a second. Running it
 * again is safe.
 *
 * Usage:
 *   # count each group and print the flags for a write run
 *   RESEND_API_KEY=re_xxx RESEND_NEWSLETTER_SEGMENT_ID=... RESEND_NEWSLETTER_TOPIC_ID=... \
 *     DATABASE_URL=... pnpm --filter @llmgateway/scripts resend-contacts-trim
 *
 *   # count some groups only: the printed --max is then for those groups
 *   ... pnpm --filter @llmgateway/scripts resend-contacts-trim --remove=suppressed
 *
 *   # remove the groups you name
 *   ... pnpm --filter @llmgateway/scripts resend-contacts-trim --apply \
 *     --remove=suppressed --max=1200
 *
 * Flags:
 *   --remove=a,b              The groups to check, and to delete with --apply.
 *   --apply                   Delete. Needs --remove and --max.
 *   --max=n                   Delete nothing when more than n contacts are
 *                             candidates.
 *   --allow-local-database    Production reached through a local tunnel.
 *
 * Environment (all required):
 *   RESEND_API_KEY, RESEND_NEWSLETTER_TOPIC_ID, RESEND_NEWSLETTER_SEGMENT_ID
 *   DATABASE_URL   The production database, read for accounts.
 */

import { setTimeout as sleep } from "timers/promises";

import { db, sql, tables } from "@llmgateway/db";
import { resendFetch } from "@llmgateway/shared/resend-api";

import {
	assertProductionDatabase,
	pacedWithRetry,
	requireEnv,
} from "./newsletter-segment-backfill-lib.js";
import {
	parseTrimArgs,
	reportLines,
	trimContacts,
	TrimStopped,
	type TrimResult,
} from "./resend-contacts-trim-lib.js";

const account = {
	email: tables.user.email,
	status: tables.user.status,
	riskStatus: tables.user.riskStatus,
	emailVerified: tables.user.emailVerified,
};

async function main() {
	const args = parseTrimArgs(process.argv.slice(2));
	const apiKey = requireEnv("RESEND_API_KEY");
	const topicId = requireEnv("RESEND_NEWSLETTER_TOPIC_ID");
	const newsletterSegmentId = requireEnv("RESEND_NEWSLETTER_SEGMENT_ID");
	const databaseHost = new URL(requireEnv("DATABASE_URL")).hostname;
	if (args.apply) {
		assertProductionDatabase(databaseHost, args.allowLocalDatabase);
	}

	const pause = async (ms: number) => {
		await sleep(ms);
	};
	let result: TrimResult;
	try {
		result = await trimContacts({
			request: pacedWithRetry(
				async (method, path) => await resendFetch({ apiKey, method, path }),
				pause,
			),
			loadAccounts: async () => {
				const rows = await db.select(account).from(tables.user);
				console.log(`Database: ${rows.length} accounts read`);
				return rows;
			},
			findAccounts: async (address) =>
				await db
					.select(account)
					.from(tables.user)
					.where(sql`lower(trim(${tables.user.email})) = ${address}`),
			newsletterSegmentId,
			topicId,
			apply: args.apply,
			remove: args.remove,
			max: args.max,
			onProgress: (line) => console.log(line),
		});
	} catch (error) {
		if (error instanceof TrimStopped) {
			console.log("Stopped early. Counted until then:");
			console.log(reportLines(error.result, args, false).join("\n"));
		}
		throw error;
	}
	console.log(reportLines(result, args).join("\n"));
}

void main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
