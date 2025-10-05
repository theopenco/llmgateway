import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config-server";
import { getUser } from "@/lib/getUser";

import type { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
	const user = await getUser();
	const cookieStore = await cookies();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const body = await req.json();
	const { projectId } = body || {};
	if (!projectId) {
		return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
	}

	const config = getConfig();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(`${key}`);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	const cookieHeader = secureSessionCookie
		? `__Secure-${key}=${secureSessionCookie.value}`
		: sessionCookie
			? `${key}=${sessionCookie.value}`
			: "";

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
	const data = (await res.json()) as { ok: boolean; token?: string };
	const response = NextResponse.json({ ok: true });
	if (data?.token) {
		response.cookies.set("llmgateway_playground_key", data.token, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60 * 24 * 30,
		});
	}
	return response;
}
