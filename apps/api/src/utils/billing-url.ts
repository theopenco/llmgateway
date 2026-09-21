export type BillingOrganizationKind = "default" | "devpass" | "chat";

/**
 * Billing page for the organization's product. Each kind has its own
 * dashboard, so a DevPass or Lounge customer must never be sent to the main
 * dashboard's billing page.
 */
export function getBillingPageUrl(organization: {
	id: string;
	kind: BillingOrganizationKind;
}): string {
	switch (organization.kind) {
		case "devpass":
			return `${process.env.CODE_URL ?? "https://code.llmgateway.io"}/dashboard/billing`;
		case "chat":
			return `${process.env.PLAYGROUND_URL ?? "https://chat.llmgateway.io"}/pricing`;
		default:
			return `${process.env.UI_URL ?? "https://llmgateway.io"}/dashboard/${organization.id}/org/billing`;
	}
}
