import {
	auditLog,
	db,
	platformAuditLog,
	type AuditLogAction,
	type AuditLogMetadata,
	type AuditLogResourceType,
	type FlaggedPayloadAuditMetadata,
	type PlatformAuditLogAction,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

export interface LogAuditEventParams {
	organizationId: string;
	userId: string;
	action: AuditLogAction;
	resourceType: AuditLogResourceType;
	resourceId?: string;
	metadata?: AuditLogMetadata;
}

/**
 * Logs an audit event for an organization.
 * Always logs regardless of plan — the enterprise check is enforced
 * at the API read layer so orgs upgrading later already have history.
 */
export async function logAuditEvent(
	params: LogAuditEventParams,
): Promise<void> {
	try {
		await db.insert(auditLog).values({
			organizationId: params.organizationId,
			userId: params.userId,
			action: params.action,
			resourceType: params.resourceType,
			resourceId: params.resourceId,
			metadata: params.metadata,
		});
	} catch (error) {
		// Silently fail audit logging to not affect main operations
		logger.error("Failed to log audit event", error);
	}
}

export interface LogPlatformAuditEventParams {
	userId: string;
	action: PlatformAuditLogAction;
	resourceType: string;
	resourceId?: string;
	metadata: FlaggedPayloadAuditMetadata;
}

/**
 * Logs a staff action on a platform-owned resource to `platform_audit_log`,
 * which customers never read. Throws on failure: callers record the access
 * before revealing the resource, so a failed write denies the access.
 */
export async function logPlatformAuditEvent(
	params: LogPlatformAuditEventParams,
): Promise<void> {
	await db.insert(platformAuditLog).values({
		userId: params.userId,
		action: params.action,
		resourceType: params.resourceType,
		resourceId: params.resourceId,
		metadata: params.metadata,
	});
}
