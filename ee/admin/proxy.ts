import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

interface MeResponse {
	user: {
		id: string;
		email: string;
		isAdmin?: boolean;
	};
}

export async function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;

	// Allow auth, static routes, and root path without admin check
	if (
		pathname === "/" ||
		pathname.startsWith("/login") ||
		pathname.startsWith("/signup") ||
		pathname.startsWith("/_next") ||
		pathname.startsWith("/favicon") ||
		pathname.startsWith("/api")
	) {
		return NextResponse.next();
	}

	const apiUrl =
		process.env.API_BACKEND_URL ??
		process.env.API_URL ??
		"http://localhost:4002";

	const key = "better-auth.session_token";
	const cookies = req.cookies;
	const secureSession = cookies.get(`__Secure-${key}`)?.value;
	const session = cookies.get(key)?.value;

	const cookieHeader = secureSession
		? `__Secure-${key}=${secureSession}`
		: session
			? `${key}=${session}`
			: "";

	if (!cookieHeader) {
		const loginUrl = new URL("/login", req.url);
		loginUrl.searchParams.set("returnUrl", pathname || "/");
		return NextResponse.redirect(loginUrl);
	}

	try {
		const res = await fetch(`${apiUrl}/user/me`, {
			method: "GET",
			headers: {
				Cookie: cookieHeader,
			},
		});

		if (!res.ok) {
			const loginUrl = new URL("/login", req.url);
			loginUrl.searchParams.set("returnUrl", pathname || "/");
			return NextResponse.redirect(loginUrl);
		}

		const data = (await res.json()) as MeResponse;

		if (!data.user?.isAdmin) {
			return new NextResponse("Forbidden: admin access required", {
				status: 403,
			});
		}
	} catch {
		return new NextResponse("Forbidden: admin access required", {
			status: 403,
		});
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
