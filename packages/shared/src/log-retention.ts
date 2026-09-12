export const LOG_RETENTION_DAYS = 30;

export function getLogRetentionCutoff(now = new Date()): Date {
	const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	return new Date(now.getTime() - retentionMs);
}

export function isRoutingMetadataExpired(
	log: { createdAt: string | Date; routingMetadata?: unknown },
	now = new Date(),
): boolean {
	return (
		log.routingMetadata === null &&
		new Date(log.createdAt) < getLogRetentionCutoff(now)
	);
}
