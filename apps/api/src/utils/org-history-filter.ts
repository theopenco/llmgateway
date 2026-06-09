import { db, eq, isNull, or } from "@llmgateway/db";

import type { SQL, Column } from "@llmgateway/db";

// Build an org filter for user-owned history (chats, image/video generations).
// When an organizationId is given we scope to it; for the dedicated Chat org
// (the "Chat plan" context) we also include legacy rows with no org so existing
// history keeps showing there. Returns undefined when no org id is provided.
export async function buildOrgHistoryFilter(
	column: Column,
	organizationId: string | undefined,
): Promise<SQL | undefined> {
	if (!organizationId) {
		return undefined;
	}
	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});
	if (!org || org.isChat) {
		return or(eq(column, organizationId), isNull(column));
	}
	return eq(column, organizationId);
}
