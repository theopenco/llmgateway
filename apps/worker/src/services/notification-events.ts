import { db, notification } from "@llmgateway/db";

import type { ApiKeyScope } from "@llmgateway/actions";
import type { notificationPreference } from "@llmgateway/db";

export type Preference = typeof notificationPreference.$inferSelect;
export type NotificationEvent = Pick<
	typeof notification.$inferInsert,
	"projectId" | "apiKeyId" | "type" | "eventKey" | "title" | "message" | "href"
>;

export function canReadEvent(
	scope: ApiKeyScope,
	event: Pick<NotificationEvent, "projectId" | "apiKeyId">,
): boolean {
	if (!event.projectId) {
		return false;
	}
	return (
		scope.privilegedProjectIds.includes(event.projectId) ||
		(scope.restrictedProjectIds.includes(event.projectId) &&
			!!event.apiKeyId &&
			scope.ownApiKeyIds.includes(event.apiKeyId))
	);
}

export async function recordEvent(
	userId: string,
	preference: Preference,
	event: NotificationEvent,
): Promise<boolean> {
	const inserted = await db
		.insert(notification)
		.values({
			...event,
			userId,
			inApp: preference.inApp,
			email: preference.email,
		})
		.onConflictDoNothing()
		.returning({ id: notification.id });
	return inserted.length > 0;
}
