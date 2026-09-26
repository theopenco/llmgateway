import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { tables } from "@llmgateway/db";

import type { db } from "@llmgateway/db";

type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function createAuthDatabase(database: Database) {
	return drizzleAdapter(database, {
		provider: "pg",
		schema: {
			user: tables.user,
			session: tables.session,
			account: tables.account,
			verification: tables.verification,
			deviceCode: tables.deviceCode,
			passkey: tables.passkey,
			ssoProvider: tables.ssoProvider,
		},
	});
}
