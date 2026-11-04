// Single source of truth for the organization detail page tabs. The page uses
// this list to validate `?tab=` and `OrganizationTabTrigger` only accepts these
// values, so adding a tab trigger without listing it here fails typecheck.
export const ORGANIZATION_TAB_VALUES = [
	"transactions",
	"api-keys",
	"provider-keys",
	"members",
	"logs",
	"audit-logs",
	"settings",
	"guardrails",
	"provider-access",
	"sso",
] as const;

export type OrganizationTabValue = (typeof ORGANIZATION_TAB_VALUES)[number];

export const DEFAULT_ORGANIZATION_TAB: OrganizationTabValue = "transactions";

export function parseOrganizationTab(
	value: string | undefined,
): OrganizationTabValue {
	return (ORGANIZATION_TAB_VALUES as readonly string[]).includes(value ?? "")
		? (value as OrganizationTabValue)
		: DEFAULT_ORGANIZATION_TAB;
}
