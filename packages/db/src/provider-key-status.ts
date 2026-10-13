/**
 * Statuses of a provider key its owner removed. Treat both as deleted
 * everywhere except reasoning-credential pinning, which may still resolve a
 * "pending_deletion" key during its grace period.
 */
export const REMOVED_PROVIDER_KEY_STATUSES = [
	"pending_deletion",
	"deleted",
] as const;

/** How long a deleted provider key stays "pending_deletion" before teardown. */
export const PROVIDER_KEY_DELETION_GRACE_SECONDS = 24 * 60 * 60;

export function isRemovedProviderKeyStatus(
	status: string | null | undefined,
): boolean {
	return status === "pending_deletion" || status === "deleted";
}

/**
 * Status a deleted key moves to. Custom-provider keys never carry
 * provider-bound reasoning, so they are deleted immediately and free their
 * name for reuse.
 */
export function deletedProviderKeyStatus(
	provider: string,
): "pending_deletion" | "deleted" {
	return provider === "custom" ? "deleted" : "pending_deletion";
}
