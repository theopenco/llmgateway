import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function hasSessionCookie() {
	const cookieStore = await cookies();

	return (
		cookieStore.has("better-auth.session_token") ||
		cookieStore.has("__Secure-better-auth.session_token")
	);
}

export async function requireSession() {
	if (!(await hasSessionCookie())) {
		redirect("/login");
	}
}
