import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { hasWhiteLabelAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

/**
 * Admin panel roles, each keyed on an email allowlist:
 * - `admin` (`ADMIN_EMAILS`): full access.
 * - `support` (`ADMIN_SUPPORT_EMAILS`): `viewer` plus {@link SUPPORT_WRITE_ROUTES}.
 * - `viewer` (`ADMIN_VIEWER_EMAILS`): read-only, without platform-wide
 *   financials ({@link STAFF_HIDDEN_ROUTES}) or margin/profit fields.
 */
export type AdminRole = "admin" | "support" | "viewer";

function emailList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
	return (
		!!email && emailList(process.env.ADMIN_EMAILS).includes(email.toLowerCase())
	);
}

/**
 * The admin panel role for a user. Authority is keyed on the email address, so
 * an unverified one never counts — otherwise changing your email to an
 * allowlisted address would grant access.
 */
export function getAdminRole(user: {
	email: string | null | undefined;
	emailVerified: boolean;
}): AdminRole | null {
	if (!user.emailVerified || !user.email) {
		return null;
	}
	const email = user.email.toLowerCase();
	if (emailList(process.env.ADMIN_EMAILS).includes(email)) {
		return "admin";
	}
	if (emailList(process.env.ADMIN_SUPPORT_EMAILS).includes(email)) {
		return "support";
	}
	if (emailList(process.env.ADMIN_VIEWER_EMAILS).includes(email)) {
		return "viewer";
	}
	return null;
}

// Paths are relative to the `/admin` mount.
const SUPPORT_WRITE_ROUTES: { method: string; path: RegExp }[] = [
	{ method: "POST", path: /^\/devpass\/[^/]+\/refund$/ },
];

// Platform-wide revenue, profit and provider-cost views.
const STAFF_HIDDEN_ROUTES: RegExp[] = [
	/^\/metrics(\/.*)?$/,
	/^\/global-stats(\/.*)?$/,
	/^\/devpass\/(kpis|timeseries|payg|usage)$/,
	/^\/chat-plans\/(timeseries|usage)$/,
	/^\/sdk$/,
	/^\/provider-credentials\/spend$/,
];

// Response keys stripped for non-admin roles wherever they appear.
const STAFF_REDACTED_KEY = /margin|profit|platformFee/i;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isAdminRequestAllowed(
	role: AdminRole,
	method: string,
	path: string,
): boolean {
	if (role === "admin") {
		return true;
	}
	const upperMethod = method.toUpperCase();
	if (READ_METHODS.has(upperMethod)) {
		return !STAFF_HIDDEN_ROUTES.some((pattern) => pattern.test(path));
	}
	return (
		role === "support" &&
		SUPPORT_WRITE_ROUTES.some(
			(route) => route.method === upperMethod && route.path.test(path),
		)
	);
}

export function redactStaffFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactStaffFields);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => !STAFF_REDACTED_KEY.test(key))
				.map(([key, entry]) => [key, redactStaffFields(entry)]),
		);
	}
	return value;
}

function adminRelativePath(path: string): string {
	return path.replace(/^.*?\/admin(?=\/|$)/, "") || "/";
}

// Every sub-app mounted at `/admin` registers this middleware on `/*`, so one
// request passes through it once per sub-app; only the outermost pass acts.
const checkedRequests = new WeakSet<Request>();

function createAdminMiddleware(requireWhiteLabel: boolean) {
	return createMiddleware<ServerTypes>(async (c, next) => {
		const authUser = c.get("user");

		if (!authUser) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}

		const role = getAdminRole(authUser);
		if (!role) {
			throw new HTTPException(403, { message: "Admin access required" });
		}

		if (requireWhiteLabel && !hasWhiteLabelAccess()) {
			throw new HTTPException(403, {
				message: "A valid white-label license is required",
			});
		}

		if (checkedRequests.has(c.req.raw)) {
			return await next();
		}
		checkedRequests.add(c.req.raw);

		if (
			!isAdminRequestAllowed(role, c.req.method, adminRelativePath(c.req.path))
		) {
			throw new HTTPException(403, {
				message: `The ${role} role cannot access this resource`,
			});
		}

		await next();

		if (role !== "admin") {
			await redactResponse(c);
		}
	});
}

async function redactResponse(c: Context<ServerTypes>) {
	const original = c.res;
	if (!original.headers.get("content-type")?.includes("application/json")) {
		return;
	}
	const body: unknown = await original.clone().json();
	const headers = new Headers(original.headers);
	headers.delete("content-length");
	// Clear first: the setter would otherwise copy the stale content-length back.
	c.res = undefined;
	c.res = new Response(JSON.stringify(redactStaffFields(body)), {
		status: original.status,
		headers,
	});
}

/** Admin access without the white-label license check. */
export const adminAuthMiddleware = createAdminMiddleware(false);

export const adminMiddleware = createAdminMiddleware(true);
