import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

// Better Auth appends `?error=<code>` (and sometimes `?error_description=`) to
// the post-OAuth callback URL when a social sign-in fails (e.g.
// `account_not_linked`). If that lands on `/dashboard`, the dashboard layout
// redirects unauthenticated users straight to `/login` and drops the query, so
// the error is never shown. Catch it here first and forward the code to the
// login page, which renders it as a toast.
export function middleware(request: NextRequest) {
	const { pathname, searchParams } = request.nextUrl;
	const error = searchParams.get("error");

	if (!error || !pathname.startsWith("/dashboard")) {
		return NextResponse.next();
	}

	const url = request.nextUrl.clone();
	url.pathname = "/login";

	const preserved = new URLSearchParams();
	preserved.set("error", error);
	const description = searchParams.get("error_description");
	if (description) {
		preserved.set("error_description", description);
	}
	url.search = preserved.toString();

	return NextResponse.redirect(url);
}

export const config = {
	matcher: ["/dashboard", "/dashboard/:path*"],
};
