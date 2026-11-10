import { loadCrmBook, resolveAccountIdForEmail } from "@/lib/crm.js";

import { and, db, eq, isNull, tables } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

const FOLLOW_UP_BUSINESS_DAYS = 1;
const SUNDAY = 0;
const SATURDAY = 6;

export interface InboundLead {
	id: string;
	name: string;
	email: string;
}

/** `days` working days after `from`, at the same time of day (UTC). */
export function addBusinessDays(from: Date, days: number): Date {
	const due = new Date(from);
	let remaining = days;
	while (remaining > 0) {
		due.setUTCDate(due.getUTCDate() + 1);
		const weekday = due.getUTCDay();
		if (weekday !== SATURDAY && weekday !== SUNDAY) {
			remaining--;
		}
	}
	return due;
}

/**
 * Gives an inbound lead a follow-up due the next working day and, when
 * `CRM_DEFAULT_OWNER_EMAIL` is set, an owner, so no lead waits in the list
 * unassigned with nothing due. A company that already has an open task keeps
 * that one. The lead is stored before this runs, so a failure here is logged
 * and never fails the visitor's submission.
 */
export async function scheduleLeadFollowUp(
	lead: InboundLead,
	now: Date = new Date(),
): Promise<void> {
	try {
		const accountId = await resolveAccountIdForEmail(
			lead.email,
			await loadCrmBook(now),
		);
		if (!accountId) {
			logger.warn("Inbound lead is not in the CRM book; no follow-up set", {
				submissionId: lead.id,
			});
			return;
		}

		const ownerEmail = process.env.CRM_DEFAULT_OWNER_EMAIL || null;
		await db
			.insert(tables.crmAccount)
			.values({ id: accountId, ownerEmail })
			.onConflictDoNothing();
		if (ownerEmail) {
			await db
				.update(tables.crmAccount)
				.set({ ownerEmail })
				.where(
					and(
						eq(tables.crmAccount.id, accountId),
						isNull(tables.crmAccount.ownerEmail),
					),
				);
		}

		const openTask = await db.query.crmActivity.findFirst({
			where: {
				accountId: { eq: accountId },
				kind: { eq: "task" },
				completedAt: { isNull: true },
			},
			columns: { id: true },
		});
		if (openTask) {
			return;
		}
		await db
			.insert(tables.crmActivity)
			.values({
				accountId,
				kind: "task",
				subject: `Reply to ${lead.name}'s enterprise inquiry`,
				contactEmail: lead.email.trim().toLowerCase(),
				dueAt: addBusinessDays(now, FOLLOW_UP_BUSINESS_DAYS),
				externalRef: `lead:${lead.id}`,
			})
			.onConflictDoNothing();
	} catch (error) {
		logger.error(
			"Failed to schedule a follow-up for an enterprise lead",
			toError(error),
		);
	}
}
