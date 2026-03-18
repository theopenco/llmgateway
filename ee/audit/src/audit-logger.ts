import {
	auditLog,
	db,
	type AuditLogAction,
	type AuditLogMetadata,
	type AuditLogResourceType,
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
