"use client";

import { canRefund, canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";

import type { ReactNode } from "react";

interface RoleGateProps {
	children: ReactNode;
	fallback?: ReactNode;
}

/** Renders its children only for full admins. */
export function AdminOnly({ children, fallback = null }: RoleGateProps) {
	return canWrite(useAdminRole()) ? children : fallback;
}

/** Renders its children for roles allowed to issue refunds. */
export function RefundOnly({ children, fallback = null }: RoleGateProps) {
	return canRefund(useAdminRole()) ? children : fallback;
}
