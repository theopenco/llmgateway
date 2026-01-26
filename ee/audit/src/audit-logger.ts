import {
	auditLog,
	db,
	eq,
	organization as organizationTable,
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
 * Only logs if the organization has an enterprise plan.
 */
export async function logAuditEvent(
	params: LogAuditEventParams,
): Promise<void> {
	try {
		// Check if organization has enterprise plan before logging
		const org = await db
			.select({ plan: organizationTable.plan })
			.from(organizationTable)
			.where(eq(organizationTable.id, params.organizationId))
			.limit(1);

		// Only log for enterprise organizations
		if (!org[0] || org[0].plan !== "enterprise") {
			return;
		}

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
		logger.error("Failed to log audit event", { error });
	}
}
