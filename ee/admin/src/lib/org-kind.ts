/**
 * Organization-kind view for global usage reporting. Mirrors
 * `organization.kind`, which the global stats aggregator stamps onto every row.
 *
 * The kind is a proxy for *which wallet paid*, not a record of it: the billing
 * worker resolves the credit pool (chat plan → dev plan → regular credits) at
 * charge time and never stamps the choice onto the log row. So DevPass credits
 * spend covers both plan-included credits and any real PAYG overflow.
 */
export type OrgKind = "all" | "default" | "devpass" | "chat" | "unknown";

// "Unattributed" is a selectable option, not just a URL value: rows aggregated
// before this dimension existed keep that kind permanently (no backfill ships),
// so drilling into them is the only way to see what they contain.
export const ORG_KIND_OPTIONS: { value: OrgKind; label: string }[] = [
	{ value: "all", label: "All orgs" },
	{ value: "default", label: "PAYG" },
	{ value: "devpass", label: "DevPass" },
	{ value: "chat", label: "Chat" },
	{ value: "unknown", label: "Unattributed" },
];

export function parseOrgKind(value: string | null | undefined): OrgKind {
	return ORG_KIND_OPTIONS.some((o) => o.value === value)
		? (value as OrgKind)
		: "all";
}

export function orgKindLabel(kind: OrgKind): string {
	return ORG_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? "All orgs";
}

export function orgKindDescription(kind: OrgKind): string | null {
	if (kind === "default") {
		return "Pay-as-you-go organizations only — spend burns real credits.";
	}
	if (kind === "devpass") {
		return "DevPass organizations only — spend is subscription COGS, plus any PAYG overflow.";
	}
	if (kind === "chat") {
		return "Chat organizations only — spend is subscription COGS against virtual credits.";
	}
	if (kind === "unknown") {
		return "Traffic aggregated before organization-kind attribution existed.";
	}
	return null;
}
