import { posthog } from "@/posthog.js";

import { tables } from "@llmgateway/db";

import type { OrganizationTransaction } from "@/lib/billing-operation.js";

export async function recordProCancellationTransition(
	tx: OrganizationTransaction,
	organization: { id: string; subscriptionCancelled: boolean | null },
	cancelled: boolean,
): Promise<boolean> {
	if (cancelled && !organization.subscriptionCancelled) {
		await tx.insert(tables.transaction).values({
			organizationId: organization.id,
			type: "subscription_cancel",
			currency: "USD",
			status: "completed",
			description: "Pro subscription cancelled",
		});
	}
	return !cancelled && !!organization.subscriptionCancelled;
}

export function trackProReactivation(
	organization: { id: string; name: string },
	source: string,
): void {
	posthog.groupIdentify({
		groupType: "organization",
		groupKey: organization.id,
		properties: { name: organization.name },
	});
	posthog.capture({
		distinctId: "organization",
		event: "subscription_reactivated",
		groups: { organization: organization.id },
		properties: { plan: "pro", organization: organization.id, source },
	});
}
