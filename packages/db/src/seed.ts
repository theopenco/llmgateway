import { randomUUID } from "crypto";

import { redisClient } from "@llmgateway/cache";

import { closeCachedDatabase, closeDatabase, db, tables } from "./index.js";
import { logs } from "./logs.js";

import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Universal upsert function that handles inserting data with conflict resolution
 * @param table The table to insert into
 * @param values The values to insert (single object or array of objects)
 * @param uniqueKey The column name that serves as the unique identifier (usually 'id')
 * @returns The result of the insert operation
 */
async function upsert<T extends Record<string, any>>(
	table: PgTable<any>,
	values: T,
	uniqueKey = "id",
) {
	return await db
		.insert(table)
		.values(values)
		.onConflictDoUpdate({
			target: table[uniqueKey as keyof typeof table] as any,
			set: values,
		});
}

async function seed() {
	// Insert installation record for self-hosted tracking
	await upsert(tables.installation, {
		id: "self-hosted-installation",
		uuid: randomUUID(),
		type: "self-host",
	});

	// Insert user
	await upsert(tables.user, {
		id: "test-user-id",
		name: "Test User",
		email: "admin@example.com",
		emailVerified: true,
	});

	// Insert account
	await upsert(tables.account, {
		id: "test-account-id",
		providerId: "credential",
		accountId: "test-account-id",
		password:
			"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
		userId: "test-user-id",
	});

	// Insert organization
	await upsert(tables.organization, {
		id: "test-org-id",
		name: "Test Organization",
		credits: 5,
	});

	// Insert user organization relationship
	await upsert(tables.userOrganization, {
		id: "test-user-org-id",
		userId: "test-user-id",
		organizationId: "test-org-id",
	});

	// Insert project
	await upsert(tables.project, {
		id: "test-project-id",
		name: "Test Project",
		organizationId: "test-org-id",
		mode: "hybrid",
	});

	// Insert API key
	await upsert(tables.apiKey, {
		id: "test-api-key-id",
		token: "test-token",
		projectId: "test-project-id",
		description: "Test API Key",
		createdBy: "test-user-id",
	});

	// Insert logs
	await Promise.all(logs.map((log) => upsert(tables.log, log)));

	// Cleanup all connections
	await Promise.all([closeDatabase(), closeCachedDatabase()]);

	await redisClient.quit();
}

void seed();
