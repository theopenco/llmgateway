"use client";

import { createContext, use } from "react";

import { useUser } from "@/hooks/useUser";

import type { AdminRole } from "./admin-role";
import type { ReactNode } from "react";

const AdminRoleContext = createContext<AdminRole | null>(null);

export function AdminRoleProvider({
	role,
	children,
}: {
	role: AdminRole | null;
	children: ReactNode;
}) {
	return <AdminRoleContext value={role}>{children}</AdminRoleContext>;
}

/**
 * The signed-in user's admin role. The server-rendered role covers the first
 * paint; `/user/me` takes over once loaded (e.g. after signing in).
 */
export function useAdminRole(): AdminRole | null {
	const serverRole = use(AdminRoleContext);
	const { user } = useUser();
	return user ? (user.adminRole ?? null) : serverRole;
}
