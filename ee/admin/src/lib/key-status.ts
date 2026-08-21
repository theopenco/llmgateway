/**
 * Status filter for the API-key and provider-key lists on the organization
 * detail page. Mirrors the `status` enum both key tables share.
 *
 * Keys are soft-deleted rather than removed, so an organization accumulates
 * `deleted` rows forever. The list therefore defaults to `active` — the only
 * status that says anything about what the organization can do right now —
 * and the other views exist for forensics.
 */
export type KeyStatusFilter = "active" | "inactive" | "deleted" | "all";

export const KEY_STATUS_DEFAULT: KeyStatusFilter = "active";

export const KEY_STATUS_OPTIONS: { value: KeyStatusFilter; label: string }[] = [
	{ value: "active", label: "Active" },
	{ value: "inactive", label: "Disabled" },
	{ value: "deleted", label: "Deleted" },
	{ value: "all", label: "All" },
];

export function parseKeyStatus(
	value: string | null | undefined,
): KeyStatusFilter {
	return KEY_STATUS_OPTIONS.some((o) => o.value === value)
		? (value as KeyStatusFilter)
		: KEY_STATUS_DEFAULT;
}
