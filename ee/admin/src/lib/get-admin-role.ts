import { cache } from "react";

import { getUser } from "./getUser";

import type { AdminRole } from "./admin-role";

/** The session's admin role for server components, fetched once per request. */
export const getSessionAdminRole = cache(
	async (): Promise<AdminRole | null> => (await getUser())?.adminRole ?? null,
);
