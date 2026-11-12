import { db, eq, tables } from "@llmgateway/db";
import {
	hashApiKeyForStorage,
	hashTokenForStorage,
} from "@llmgateway/shared/api-key-hash";

export const sdkToken = "es_security-test-session";

export async function seedGatewaySdkSession(): Promise<void> {
	await db
		.update(tables.project)
		.set({ endUserEnabled: true, allowedOrigins: ["https://allowed.example"] })
		.where(eq(tables.project.id, "project-id"));
	await db.insert(tables.endCustomer).values({
		id: "sdk-customer",
		organizationId: "org-id",
		projectId: "project-id",
		externalId: "sdk-customer",
		mode: "test",
	});
	await db.insert(tables.wallet).values({
		id: "sdk-wallet",
		endCustomerId: "sdk-customer",
		organizationId: "org-id",
		projectId: "project-id",
		mode: "test",
		balance: "1",
	});
	await db.insert(tables.apiKey).values({
		id: "sdk-aggregate-key",
		description: "SDK session aggregate",
		...hashApiKeyForStorage("sdk-aggregate-token"),
		projectId: "project-id",
		createdBy: "user-id",
		keyType: "end_user_customer",
		endCustomerWalletId: "sdk-wallet",
	});
	await db.insert(tables.endUserSession).values({
		id: "sdk-session",
		...hashTokenForStorage(sdkToken),
		organizationId: "org-id",
		projectId: "project-id",
		endCustomerId: "sdk-customer",
		walletId: "sdk-wallet",
		createdBy: "user-id",
		expiresAt: new Date(Date.now() + 60_000),
	});
}
