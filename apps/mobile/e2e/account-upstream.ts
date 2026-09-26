import process from "node:process";

import { z } from "zod";

const address = z.string().regex(/^native-account-\d+@example\.test$/);
const mail = z.object({
	to: address,
	subject: z.string(),
	text: z.string(),
});
const inbox = new Map<string, { verify?: string; reset?: string }>();

export async function accountUpstream(request: Request) {
	const url = new URL(request.url);
	if (url.pathname !== "/fixture-accounts/mail") {
		return null;
	}
	if (
		!process.env.STACK_SUFFIX ||
		!["localhost", "127.0.0.1"].includes(url.hostname)
	) {
		return new Response("Local account fixtures only", { status: 403 });
	}
	if (request.method === "POST") {
		const parsed = mail.safeParse(await request.json());
		if (!parsed.success) {
			return new Response("Disposable test addresses only", { status: 400 });
		}
		const link = parsed.data.text.match(/https?:\/\/\S+/)?.[0];
		if (!link) {
			return new Response("No account link", { status: 400 });
		}
		const target = new URL(link);
		if (
			target.origin !== process.env.API_URL ||
			!/^\/auth\/(verify-email|reset-password\/)/.test(target.pathname)
		) {
			return new Response("Local account links only", { status: 400 });
		}
		const kind = target.pathname === "/auth/verify-email" ? "verify" : "reset";
		inbox.set(parsed.data.to, { ...inbox.get(parsed.data.to), [kind]: link });
		return Response.json({ delivered: true });
	}
	if (request.method === "GET") {
		const email = address.safeParse(url.searchParams.get("email"));
		return email.success
			? Response.json(inbox.get(email.data) ?? {})
			: new Response("Disposable test addresses only", { status: 400 });
	}
	return new Response("Method not allowed", { status: 405 });
}
