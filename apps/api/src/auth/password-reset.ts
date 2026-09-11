import { runWithTransaction } from "@better-auth/core/context";
import {
	createAuthEndpoint,
	requestPasswordReset,
	resetPassword,
} from "better-auth/api";

import { createAuthDatabase } from "@/auth/database.js";

import { db, eq, tables } from "@llmgateway/db";

import type { AuthContext, BetterAuthPlugin } from "better-auth";

async function withUserTransaction<T>(
	userId: string | undefined,
	context: AuthContext,
	callback: () => Promise<T>,
): Promise<T> {
	if (!userId) {
		return await callback();
	}
	// Keep native reset issuance and consumption serialized with email confirmation.
	return await runWithTransaction(
		{
			...context.adapter,
			transaction: async (run) =>
				await db.transaction(async (tx) => {
					await tx
						.select({ id: tables.user.id })
						.from(tables.user)
						.where(eq(tables.user.id, userId))
						.for("update");
					return await run(createAuthDatabase(tx)(context.options));
				}),
		},
		callback,
	);
}

export function serializedPasswordReset(): BetterAuthPlugin {
	return {
		id: "serialized-password-reset",
		endpoints: {
			resetPassword: createAuthEndpoint(
				resetPassword.path,
				resetPassword.options,
				async (ctx) => {
					const token = ctx.body.token || ctx.query?.token;
					const verification = token
						? await db.query.verification.findFirst({
								where: { identifier: `reset-password:${token}` },
							})
						: undefined;
					return await withUserTransaction(
						verification?.value,
						ctx.context,
						() =>
							resetPassword({
								...ctx,
								asResponse: false,
								returnHeaders: false,
								returnStatus: false,
							}),
					);
				},
			),
			requestPasswordReset: createAuthEndpoint(
				requestPasswordReset.path,
				requestPasswordReset.options,
				async (ctx) => {
					const user = await db.query.user.findFirst({
						where: { email: ctx.body.email.toLowerCase() },
					});
					return await withUserTransaction(user?.id, ctx.context, () =>
						requestPasswordReset({
							...ctx,
							asResponse: false,
							returnHeaders: false,
							returnStatus: false,
						}),
					);
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
