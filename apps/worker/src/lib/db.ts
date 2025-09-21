// Simple getOrganization implementation for worker (without caching)
import { db } from "@llmgateway/db";

export * from "@llmgateway/db";

export async function getOrganization(organizationId: string) {
	return await db.query.organization.findFirst({
		where: {
			id: organizationId,
		},
	});
}
