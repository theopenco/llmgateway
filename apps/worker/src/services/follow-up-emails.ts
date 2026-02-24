import {
	and,
	db,
	eq,
	followUpEmail,
	organization,
	project,
	projectHourlyStats,
	sql,
	transaction,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	fromEmail,
	getResendClient,
	replyToEmail,
} from "@llmgateway/shared/email";

type FollowUpEmailType = "no_purchase" | "low_usage" | "no_repurchase";

const FOLLOW_UP_MAX_AGE_DAYS = Number(
	process.env.FOLLOW_UP_MAX_AGE_DAYS ?? "30",
);
const HIGH_SPEND_THRESHOLD = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const maxAgeMs = FOLLOW_UP_MAX_AGE_DAYS * MS_PER_DAY;
const maxAgeAgo = new Date(Date.now() - maxAgeMs);

// ─── Email Sending ──────────────────────────────────────────────────────────

async function sendFollowUpEmail(opts: {
	to: string;
	subject: string;
	text: string;
}): Promise<void> {
	const client = getResendClient();
	if (!client) {
		logger.error(
			"RESEND_API_KEY is not configured. Follow-up email will not be sent.",
			new Error(
				`Resend not configured for email to ${opts.to} with subject: ${opts.subject}`,
			),
		);
		return;
	}

	const { data, error } = await client.emails.send({
		from: fromEmail,
		to: [opts.to],
		replyTo: replyToEmail,
		subject: opts.subject,
		text: opts.text,
	});

	if (error) {
		throw new Error(`Resend API error: ${error.message}`);
	}

	logger.info("Follow-up email sent successfully", {
		to: opts.to,
		subject: opts.subject,
		messageId: data?.id,
	});
}

// ─── Email Content ───────────────────────────────────────────────────────────

function getEmailContent(type: FollowUpEmailType): {
	subject: string;
	text: string;
} {
	switch (type) {
		case "no_purchase":
			return {
				subject:
					"Get started with LLM Gateway - Add credits to unlock all models",
				text: `Hi there,

Thanks for signing up for LLM Gateway! We noticed you haven't added any credits yet.

With credits you can access 300+ AI models from OpenAI, Anthropic, Google, and more through a single API. Here's how to get started:

1. Log in at https://llmgateway.io/dashboard
2. Add credits under Settings > Billing
3. Create an API key
4. Start making requests using the OpenAI-compatible API

Read our quickstart here: https://docs.llmgateway.io/quick-start

If you have any questions, just reply to this email and we'll be happy to help.

Best,
The LLM Gateway Team`,
			};

		case "low_usage":
			return {
				subject:
					"Your LLM Gateway credits are waiting - Need help getting started?",
				text: `Hi there,

We noticed you added credits to your LLM Gateway account a few days ago but haven't used much yet.

If you're having trouble getting started, here are some resources:

- Getting started in 5 minutes: https://llmgateway.io/blog/getting-started-in-5-minutes
- Documentation: https://docs.llmgateway.io
- Chat Playground: https://chat.llmgateway.io (test models without writing code)

If something isn't working as expected or you need help with your setup, reply to this email and we'll get you sorted out.

Best,
The LLM Gateway Team`,
			};

		case "no_repurchase":
			return {
				subject: "Your LLM Gateway credits are running low",
				text: `Hi there,

You've been making great use of LLM Gateway! We noticed your credits are getting low and you haven't topped up in a while.

To keep your API access running smoothly, you can:

1. Top up credits: https://llmgateway.io/dashboard
2. Enable auto top-up under Settings > Billing so you never run out

If there's anything we can improve, we'd love to hear your feedback. Just reply to this email.

Best,
The LLM Gateway Team`,
			};
	}
}

// ─── Recipient Resolution ────────────────────────────────────────────────────

async function getOrgRecipientEmail(
	organizationId: string,
): Promise<string | null> {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});

	if (org?.billingEmail) {
		return org.billingEmail;
	}

	const ownerMembership = await db.query.userOrganization.findFirst({
		where: {
			organizationId: { eq: organizationId },
			role: { eq: "owner" },
		},
		with: { user: true },
	});

	if (!ownerMembership?.user?.emailVerified) {
		return null;
	}

	return ownerMembership.user.email ?? null;
}

// ─── Send & Record ───────────────────────────────────────────────────────────

async function sendAndRecord(
	organizationId: string,
	emailType: FollowUpEmailType,
	recipientEmail: string,
): Promise<void> {
	const { subject, text } = getEmailContent(emailType);

	await db.insert(followUpEmail).values({
		organizationId,
		emailType,
		sentTo: recipientEmail,
	});

	if (process.env.EMAIL_FOLLOW_UPS === "true") {
		await sendFollowUpEmail({ to: recipientEmail, subject, text });
	} else {
		logger.info("Follow-up email (dry run)", {
			kind: "email_follow_up",
			emailType,
			organizationId,
			to: recipientEmail,
			subject,
			text,
		});
	}
}

// ─── Email A: Signed up but never bought credits (>24h) ─────────────────────

async function processNoPurchaseEmails(): Promise<void> {
	const twentyFourHoursAgo = new Date(Date.now() - MS_PER_DAY);

	const eligibleOrgs = await db
		.select({
			organizationId: organization.id,
		})
		.from(organization)
		.where(
			and(
				sql`${organization.createdAt} < ${twentyFourHoursAgo}`,
				sql`${organization.createdAt} > ${maxAgeAgo}`,
				eq(organization.devPlan, "none"),
				eq(organization.status, "active"),
				sql`${organization.id} NOT IN (
					SELECT ${transaction.organizationId}
					FROM ${transaction}
					WHERE ${transaction.type} = 'credit_topup'
					AND ${transaction.status} = 'completed'
				)`,
				sql`${organization.id} NOT IN (
					SELECT ${followUpEmail.organizationId}
					FROM ${followUpEmail}
					WHERE ${followUpEmail.emailType} = 'no_purchase'
				)`,
			),
		);

	for (const { organizationId } of eligibleOrgs) {
		try {
			const email = await getOrgRecipientEmail(organizationId);
			if (!email) {
				logger.warn("No email found for org, skipping no_purchase follow-up", {
					organizationId,
				});
				continue;
			}
			await sendAndRecord(organizationId, "no_purchase", email);
		} catch (error) {
			logger.error(
				`Error sending no_purchase follow-up for org ${organizationId}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}

// ─── Email B: Bought credits, used <2% after 3 days ─────────────────────────

async function processLowUsageEmails(): Promise<void> {
	const threeDaysMs = 3 * MS_PER_DAY;
	const threeDaysAgo = new Date(Date.now() - threeDaysMs);

	const rows = await db.execute<{
		organization_id: string;
		total_purchased: string;
		total_spent: string;
	}>(sql`
		SELECT
			t.organization_id,
			t.total_purchased,
			COALESCE(s.total_spent, 0) AS total_spent
		FROM (
			SELECT
				${transaction.organizationId} AS organization_id,
				SUM(CAST(${transaction.creditAmount} AS NUMERIC)) AS total_purchased,
				MIN(${transaction.createdAt}) AS first_topup
			FROM ${transaction}
			WHERE ${transaction.type} = 'credit_topup'
			AND ${transaction.status} = 'completed'
			GROUP BY ${transaction.organizationId}
			HAVING MIN(${transaction.createdAt}) < ${threeDaysAgo}
			AND MIN(${transaction.createdAt}) > ${maxAgeAgo}
		) t
		LEFT JOIN (
			SELECT
				${project.organizationId} AS organization_id,
				SUM(${projectHourlyStats.cost}) AS total_spent
			FROM ${projectHourlyStats}
			JOIN ${project} ON ${project.id} = ${projectHourlyStats.projectId}
			GROUP BY ${project.organizationId}
		) s ON s.organization_id = t.organization_id
		JOIN ${organization} o ON o.id = t.organization_id
		WHERE o.status = 'active'
		AND COALESCE(s.total_spent, 0) < (t.total_purchased * 0.02)
		AND COALESCE(s.total_spent, 0) < ${HIGH_SPEND_THRESHOLD}
		AND t.organization_id NOT IN (
			SELECT ${followUpEmail.organizationId}
			FROM ${followUpEmail}
			WHERE ${followUpEmail.emailType} = 'low_usage'
		)
	`);

	for (const row of rows.rows) {
		const organizationId = row.organization_id;
		try {
			const email = await getOrgRecipientEmail(organizationId);
			if (!email) {
				logger.warn("No email found for org, skipping low_usage follow-up", {
					organizationId,
				});
				continue;
			}
			await sendAndRecord(organizationId, "low_usage", email);
			logger.info("Processed low_usage follow-up", {
				kind: "email_follow_up",
				emailType: "low_usage",
				organizationId,
				totalPurchased: row.total_purchased,
				totalSpent: row.total_spent,
			});
		} catch (error) {
			logger.error(
				`Error sending low_usage follow-up for org ${organizationId}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}

// ─── Email C: Consumed >=50%, last topup >2 weeks ago, no repurchase ─────────

async function processNoRepurchaseEmails(): Promise<void> {
	const twoWeeksMs = 14 * MS_PER_DAY;
	const twoWeeksAgo = new Date(Date.now() - twoWeeksMs);

	const rows = await db.execute<{
		organization_id: string;
		total_purchased: string;
		total_spent: string;
	}>(sql`
		SELECT
			t.organization_id,
			t.total_purchased,
			COALESCE(s.total_spent, 0) AS total_spent
		FROM (
			SELECT
				${transaction.organizationId} AS organization_id,
				SUM(CAST(${transaction.creditAmount} AS NUMERIC)) AS total_purchased,
				MAX(${transaction.createdAt}) AS last_topup
			FROM ${transaction}
			WHERE ${transaction.type} = 'credit_topup'
			AND ${transaction.status} = 'completed'
			GROUP BY ${transaction.organizationId}
			HAVING MAX(${transaction.createdAt}) < ${twoWeeksAgo}
			AND MAX(${transaction.createdAt}) > ${maxAgeAgo}
		) t
		LEFT JOIN (
			SELECT
				${project.organizationId} AS organization_id,
				SUM(${projectHourlyStats.cost}) AS total_spent
			FROM ${projectHourlyStats}
			JOIN ${project} ON ${project.id} = ${projectHourlyStats.projectId}
			GROUP BY ${project.organizationId}
		) s ON s.organization_id = t.organization_id
		LEFT JOIN ${organization} o ON o.id = t.organization_id
		WHERE o.status = 'active'
		AND COALESCE(s.total_spent, 0) >= (t.total_purchased * 0.50)
		AND COALESCE(s.total_spent, 0) < ${HIGH_SPEND_THRESHOLD}
		AND (o.auto_top_up_enabled = false OR o.auto_top_up_enabled IS NULL)
		AND t.organization_id NOT IN (
			SELECT ${followUpEmail.organizationId}
			FROM ${followUpEmail}
			WHERE ${followUpEmail.emailType} = 'no_repurchase'
		)
	`);

	for (const row of rows.rows) {
		const organizationId = row.organization_id;
		try {
			const email = await getOrgRecipientEmail(organizationId);
			if (!email) {
				logger.warn(
					"No email found for org, skipping no_repurchase follow-up",
					{ organizationId },
				);
				continue;
			}
			await sendAndRecord(organizationId, "no_repurchase", email);
			logger.info("Processed no_repurchase follow-up", {
				kind: "email_follow_up",
				emailType: "no_repurchase",
				organizationId,
				totalPurchased: row.total_purchased,
				totalSpent: row.total_spent,
			});
		} catch (error) {
			logger.error(
				`Error sending no_repurchase follow-up for org ${organizationId}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

async function processFollowUpEmails(): Promise<void> {
	await processNoPurchaseEmails();
	await processLowUsageEmails();
	await processNoRepurchaseEmails();
}

// ─── Worker Loop ─────────────────────────────────────────────────────────────

const FOLLOW_UP_EMAILS_LOCK_KEY = "follow_up_emails";

export async function runFollowUpEmailsLoop(deps: {
	shouldStop: () => boolean;
	acquireLock: (key: string) => Promise<boolean>;
	releaseLock: (key: string) => Promise<void>;
	interruptibleSleep: (ms: number) => Promise<void>;
	registerLoop: () => void;
	unregisterLoop: () => void;
}): Promise<void> {
	deps.registerLoop();

	const interval = (process.env.NODE_ENV === "production" ? 3600 : 60) * 1000;
	logger.info(
		`Starting follow-up emails loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!deps.shouldStop()) {
			try {
				const lockAcquired = await deps.acquireLock(FOLLOW_UP_EMAILS_LOCK_KEY);
				if (lockAcquired) {
					try {
						await processFollowUpEmails();
					} finally {
						await deps.releaseLock(FOLLOW_UP_EMAILS_LOCK_KEY);
					}
				}

				if (!deps.shouldStop()) {
					await deps.interruptibleSleep(interval);
				}
			} catch (error) {
				logger.error(
					"Error in follow-up emails loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!deps.shouldStop()) {
					await deps.interruptibleSleep(30000);
				}
			}
		}
	} finally {
		deps.unregisterLoop();
		logger.info("Follow-up emails loop stopped");
	}
}
