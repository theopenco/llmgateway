import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config-server";
import {
	getPlaygroundKeyForRequest,
	PLAYGROUND_KEY_COOKIE_MAX_AGE,
	PLAYGROUND_KEY_COOKIE_NAME,
} from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import type { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
	const user = await getUser();
	const cookieStore = await cookies();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const body = await req.json();
	const { projectId } = body ?? {};
	if (!projectId) {
		return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
	}

	const config = getConfig();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(`${key}`);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	const authCookie = secureSessionCookie
		? `__Secure-${key}=${secureSessionCookie.value}`
		: sessionCookie
			? `${key}=${sessionCookie.value}`
			: "";
	const playgroundKey = getPlaygroundKeyForRequest(cookieStore);
	const cookieHeader = [
		authCookie,
		playgroundKey ? `${PLAYGROUND_KEY_COOKIE_NAME}=${playgroundKey}` : "",
	]
		.filter(Boolean)
		.join("; ");

	const res = await fetch(`${config.apiBackendUrl}/playground/ensure-key`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: cookieHeader },
		body: JSON.stringify({ projectId }),
	});

	if (!res.ok) {
		return NextResponse.json(
			{ error: "Failed to ensure key" },
			{ status: 500 },
		);
	}

	// Set httpOnly cookie on the playground domain so the chat route can read it via cookies()
	const data = (await res.json()) as {
		ok: boolean;
		token?: string;
		expiresIn?: number;
	};
	const response = NextResponse.json({ ok: true });
	if (data?.token) {
		const maxAge = data.expiresIn ?? PLAYGROUND_KEY_COOKIE_MAX_AGE;
		const options = {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge,
		} as const;
		response.cookies.set(PLAYGROUND_KEY_COOKIE_NAME, data.token, options);
	}
	return response;
}
