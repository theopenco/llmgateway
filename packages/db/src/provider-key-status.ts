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
 * Status a deleted key moves to. Only an active key gets the grace period:
 * a key someone already disabled (e.g. its spend fuse tripped) must never
 * serve again, not even pinned conversations. Custom-provider keys never
 * carry provider-bound reasoning, so they are deleted immediately and free
 * their name for reuse.
 */
export function deletedProviderKeyStatus(key: {
	provider: string;
	status: string | null;
}): "pending_deletion" | "deleted" {
	const active = key.status === "active" || key.status === null;
	return active && key.provider !== "custom" ? "pending_deletion" : "deleted";
}
