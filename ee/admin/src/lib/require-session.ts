import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function requireSession() {
	const cookieStore = await cookies();
	const hasSession =
		cookieStore.has("better-auth.session_token") ||
		cookieStore.has("__Secure-better-auth.session_token");

	if (!hasSession) {
		redirect("/login");
	}
}
