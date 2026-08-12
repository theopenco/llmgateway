import { redirect } from "next/navigation";

import { hasSessionCookie } from "@/lib/session-cookie";

export async function requireSession() {
	if (!(await hasSessionCookie())) {
		redirect("/login");
	}
}
