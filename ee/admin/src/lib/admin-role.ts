/**
 * Admin panel role from `/user/me`. The API enforces every restriction; these
 * helpers only keep the UI from offering what a role cannot do.
 */
export type AdminRole = "admin" | "support" | "viewer";

// Pages built on platform-wide revenue and profit, which staff roles cannot load.
const STAFF_HIDDEN_PAGES = ["/", "/global-stats", "/sdk"];

export function isStaffHiddenPage(pathname: string): boolean {
	return STAFF_HIDDEN_PAGES.some((page) =>
		page === "/"
			? pathname === "/" || pathname === ""
			: pathname === page || pathname.startsWith(`${page}/`),
	);
}

export function canWrite(role: AdminRole | null): boolean {
	return role === "admin";
}

export function canRefund(role: AdminRole | null): boolean {
	return role === "admin" || role === "support";
}
