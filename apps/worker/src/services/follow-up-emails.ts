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

import { sendFollowUpEmail } from "./email.js";

type FollowUpEmailType = "no_purchase" | "low_usage" | "no_repurchase";

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
3. Create a project and API key
4. Start making requests using the OpenAI-compatible API

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

- Documentation: https://docs.llmgateway.io
- Playground: https://playground.llmgateway.io (test models without writing code)
- Quick start: just point any OpenAI SDK at https://api.llmgateway.io/v1

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

1. Top up credits: https://llmgateway.io/dashboard/settings/org/billing
2. Enable auto top-up so you never run out
3. Bring your own API keys (BYOK) for any provider

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

	return ownerMembership?.user?.email ?? null;
}

// ─── Send & Record ───────────────────────────────────────────────────────────

async function sendAndRecord(
	organizationId: string,
	emailType: FollowUpEmailType,
	recipientEmail: string,
): Promise<void> {
	const { subject, text } = getEmailContent(emailType);

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

	await db.insert(followUpEmail).values({
		organizationId,
		emailType,
		sentTo: recipientEmail,
	});
}

// ─── Email A: Signed up but never bought credits (>24h) ─────────────────────

async function processNoPurchaseEmails(): Promise<void> {
	// eslint-disable-next-line no-mixed-operators
	const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

	const eligibleOrgs = await db
		.select({
			organizationId: organization.id,
		})
		.from(organization)
		.where(
			and(
				sql`${organization.createdAt} < ${twentyFourHoursAgo}`,
				eq(organization.devPlan, "none"),
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
	// eslint-disable-next-line no-mixed-operators
	const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

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
		) t
		LEFT JOIN (
			SELECT
				${project.organizationId} AS organization_id,
				SUM(${projectHourlyStats.cost}) AS total_spent
			FROM ${projectHourlyStats}
			JOIN ${project} ON ${project.id} = ${projectHourlyStats.projectId}
			GROUP BY ${project.organizationId}
		) s ON s.organization_id = t.organization_id
		WHERE COALESCE(s.total_spent, 0) < (t.total_purchased * 0.02)
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
	// eslint-disable-next-line no-mixed-operators
	const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

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
		WHERE COALESCE(s.total_spent, 0) >= (t.total_purchased * 0.50)
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

export async function processFollowUpEmails(): Promise<void> {
	await processNoPurchaseEmails();
	await processLowUsageEmails();
	await processNoRepurchaseEmails();
}
