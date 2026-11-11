/* eslint-disable no-console */
/**
 * Send a one-off email to a DevPass audience:
 *
 *   active     Everyone whose plan still runs, including a cancelled plan
 *              inside its paid period. The default.
 *   past       People who paid for a plan once and have none now (win-back).
 *   past-due   Running plans whose last renewal payment failed.
 *
 * Recipients are de-duplicated by email, and addresses that unsubscribed from
 * marketing email are skipped.
 *
 * Usage:
 *   # dry run: print the resolved recipient list and exit without sending
 *   pnpm --filter @llmgateway/scripts send-devpass --audience=past --dry-run
 *
 *   # actually send
 *   RESEND_API_KEY=re_xxx pnpm --filter @llmgateway/scripts send-devpass \
 *     --audience=past --subject="Unused DevPass allowance now carries over" \
 *     --body=body.txt
 *
 * Flags:
 *   --audience=...    active (default), past or past-due.
 *   --subject="..."   Email subject line (required to send).
 *   --body=path.txt   Path to a UTF-8 text file with the email body (required to send).
 *   --dry-run         Resolve recipients and print them, but do not send.
 *
 * Environment:
 *   RESEND_API_KEY    Required to actually send (not needed for --dry-run).
 *   DATABASE_URL      Defaults to local postgres if unset.
 */

import { readFileSync } from "fs";

import { Resend } from "resend";

import { isEmailSuppressed } from "@llmgateway/db";
import {
	buildUnsubscribeHeaders,
	renderFooterText,
	signUnsubscribeToken,
} from "@llmgateway/shared/email-unsubscribe";

import {
	parseSendArgs,
	selectDevPassAudience,
	type DevPassAudience,
	type DevPassMembership,
	type SendArgs,
} from "./devpass-audiences.js";
import { loadDevPassMemberships } from "./devpass-memberships.js";

const FROM = "Luca from LLMGateway <contact@mail.llmgateway.io>";
const REPLY_TO = "luca.steeb@llmgateway.io";
const RATE_LIMIT_DELAY_MS = 600;
const MAX_RETRIES = 5;

type Recipient = DevPassMembership;

async function sleep(ms: number) {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(recipient: Recipient, audience: DevPassAudience): string {
	if (audience === "past") {
		return "had a plan, none now";
	}
	const plan = recipient.cancelled
		? `${recipient.devPlan}, cancelled, active until ${recipient.expiresAt?.toISOString() ?? "?"}`
		: `${recipient.devPlan}, active`;
	return audience === "past-due" ? `${plan}, renewal payment failed` : plan;
}

async function sendWithRetry(
	resend: Resend,
	recipient: Recipient,
	subject: string,
	body: string,
): Promise<{ success: boolean; id?: string; error?: unknown }> {
	const token = signUnsubscribeToken({
		email: recipient.email,
		category: "marketing",
	});

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		const { data, error } = await resend.emails.send({
			from: FROM,
			to: recipient.email,
			subject,
			text: `${body}${renderFooterText("marketing", token)}`,
			replyTo: REPLY_TO,
			headers: buildUnsubscribeHeaders(token),
		});

		if (!error) {
			return { success: true, id: data?.id };
		}

		if (
			typeof error === "object" &&
			error !== null &&
			"statusCode" in error &&
			error.statusCode === 429
		) {
			const backoffMs = Math.pow(2, attempt) * 1000;
			console.log(
				`Rate limited for ${recipient.email}, waiting ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
			);
			await sleep(backoffMs);
			continue;
		}

		return { success: false, error };
	}

	return { success: false, error: "Max retries exceeded" };
}

async function main() {
	let args: SendArgs;
	try {
		args = parseSendArgs(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
	const { audience, subject, bodyPath, dryRun } = args;

	const recipients = selectDevPassAudience(
		await loadDevPassMemberships(),
		audience,
		new Date(),
	);
	console.log(`Found ${recipients.length} "${audience}" DevPass recipient(s).`);

	if (dryRun) {
		for (const r of recipients) {
			console.log(`- ${r.email} (${describe(r, audience)})`);
		}
		console.log("\nDry run: no emails sent.");
		return;
	}

	if (!subject) {
		console.error("Missing --subject. Pass --subject=\"...\" to send.");
		process.exit(1);
	}
	if (!bodyPath) {
		console.error("Missing --body. Pass --body=path/to/body.txt to send.");
		process.exit(1);
	}
	if (!process.env.RESEND_API_KEY) {
		console.error("Missing RESEND_API_KEY environment variable.");
		process.exit(1);
	}

	const body = readFileSync(bodyPath, "utf-8");
	const resend = new Resend(process.env.RESEND_API_KEY);

	let sent = 0;
	let failed = 0;
	let skipped = 0;
	for (const recipient of recipients) {
		if (await isEmailSuppressed(recipient.email, "marketing")) {
			skipped++;
			console.log(`Skipped ${recipient.email}: unsubscribed from marketing`);
			continue;
		}

		const result = await sendWithRetry(resend, recipient, subject, body);
		if (result.success) {
			sent++;
			console.log(`Sent to ${recipient.email}:`, result.id);
		} else {
			failed++;
			console.error(`Failed to send to ${recipient.email}:`, result.error);
		}
		await sleep(RATE_LIMIT_DELAY_MS);
	}

	console.log(`\nDone. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`);
}

void main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
