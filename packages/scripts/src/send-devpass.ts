/* eslint-disable no-console */
/**
 * Send a one-off email to every user with an ACTIVE DevPass subscription,
 * including users who cancelled but whose subscription is still active until
 * the end of the current billing period.
 *
 * "Active" means the user's devpass organization has:
 *   - kind = 'devpass'
 *   - devPlan != 'none'
 *   - a linked Stripe subscription (devPlanStripeSubscriptionId is set)
 *   - and either: not cancelled, OR cancelled but devPlanExpiresAt is still in
 *     the future (cancelled-but-still-active grace period).
 *
 * Recipients are de-duplicated by email (a user could own multiple devpass orgs).
 *
 * Usage:
 *   # dry run: print the resolved recipient list and exit without sending
 *   pnpm --filter @llmgateway/scripts send-devpass --subject="..." --body=body.txt --dry-run
 *
 *   # actually send
 *   RESEND_API_KEY=re_xxx pnpm --filter @llmgateway/scripts send-devpass \
 *     --subject="Important DevPass update" --body=body.txt
 *
 * Flags:
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

import { and, db, eq, gt, isNotNull, ne, or, tables } from "@llmgateway/db";

const FROM = "Luca from LLMGateway <contact@mail.llmgateway.io>";
const REPLY_TO = "luca.steeb@llmgateway.io";
const RATE_LIMIT_DELAY_MS = 600;
const MAX_RETRIES = 5;

interface Recipient {
	email: string;
	name: string | null;
	devPlan: string;
	cancelled: boolean;
	expiresAt: Date | null;
}

function getArg(name: string): string | undefined {
	const flag = `--${name}=`;
	const arg = process.argv.find((a) => a.startsWith(flag));
	return arg?.slice(flag.length);
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function sleep(ms: number) {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveDevPassRecipients(): Promise<Recipient[]> {
	const rows = await db
		.select({
			email: tables.user.email,
			name: tables.user.name,
			devPlan: tables.organization.devPlan,
			cancelled: tables.organization.devPlanCancelled,
			expiresAt: tables.organization.devPlanExpiresAt,
		})
		.from(tables.organization)
		.innerJoin(
			tables.userOrganization,
			eq(tables.userOrganization.organizationId, tables.organization.id),
		)
		.innerJoin(
			tables.user,
			eq(tables.user.id, tables.userOrganization.userId),
		)
		.where(
			and(
				eq(tables.organization.kind, "devpass"),
				ne(tables.organization.devPlan, "none"),
				isNotNull(tables.organization.devPlanStripeSubscriptionId),
				or(
					eq(tables.organization.devPlanCancelled, false),
					and(
						eq(tables.organization.devPlanCancelled, true),
						gt(tables.organization.devPlanExpiresAt, new Date()),
					),
				),
			),
		);

	const byEmail = new Map<string, Recipient>();
	for (const row of rows) {
		const key = row.email.toLowerCase();
		if (!byEmail.has(key)) {
			byEmail.set(key, row);
		}
	}
	return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

async function sendWithRetry(
	resend: Resend,
	recipient: Recipient,
	subject: string,
	body: string,
): Promise<{ success: boolean; id?: string; error?: unknown }> {
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		const { data, error } = await resend.emails.send({
			from: FROM,
			to: recipient.email,
			subject,
			text: body,
			replyTo: REPLY_TO,
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
	const dryRun = hasFlag("dry-run");
	const subject = getArg("subject");
	const bodyPath = getArg("body");

	const recipients = await getActiveDevPassRecipients();
	console.log(`Found ${recipients.length} active DevPass recipient(s).`);

	if (dryRun) {
		for (const r of recipients) {
			const status = r.cancelled
				? `cancelled, active until ${r.expiresAt?.toISOString() ?? "?"}`
				: "active";
			console.log(`- ${r.email} (${r.devPlan}, ${status})`);
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
	for (const recipient of recipients) {
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

	console.log(`\nDone. Sent: ${sent}, Failed: ${failed}.`);
}

void main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
