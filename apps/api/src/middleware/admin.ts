import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import type { ServerTypes } from "@/vars.js";

export function isAdminEmail(email: string | null | undefined): boolean {
	const adminEmailsEnv = process.env.ADMIN_EMAILS || "";
	const adminEmails = adminEmailsEnv
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	if (!email || adminEmails.length === 0) {
		return false;
	}

	return adminEmails.includes(email.toLowerCase());
}

export const adminMiddleware = createMiddleware<ServerTypes>(
	async (c, next) => {
		const authUser = c.get("user");

		if (!authUser) {
			throw new HTTPException(401, {
				message: "Unauthorized",
			});
		}

		if (!isAdminEmail(authUser.email)) {
			throw new HTTPException(403, {
				message: "Admin access required",
			});
		}

		return await next();
	},
);
