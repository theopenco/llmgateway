import { createHash, randomBytes } from "node:crypto";
import process from "node:process";

import {
	connectorChatStats,
	connectorChatUpstream,
} from "./connector-chat-upstream";

const authorizations = new Map<
	string,
	{ callback: URL; challenge: string; code?: string }
>();
const stats = { connected: 0, denied: 0, toolCalls: 0 };

export async function connectorUpstream(
	request: Request,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname === "/mock/connectors") {
		return Response.json({ ...stats, ...connectorChatStats });
	}
	const chat = await connectorChatUpstream(request);
	if (chat) {
		return chat;
	}
	if (!url.pathname.startsWith("/fixture-connectors/")) {
		return null;
	}
	if (url.pathname === "/fixture-connectors/authorize") {
		const state = url.searchParams.get("state") ?? "";
		const callback = new URL(
			url.searchParams.get("redirect_uri") ?? "http://invalid",
		);
		const challenge = url.searchParams.get("code_challenge") ?? "";
		if (
			!/^[\w-]{32,128}$/.test(state) ||
			!challenge ||
			callback.origin !== process.env.API_URL ||
			!/^\/connectors\/(gmail|google-drive)\/callback$/.test(callback.pathname)
		) {
			return new Response("Invalid fixture authorization", { status: 400 });
		}
		authorizations.set(state, { callback, challenge });
		return new Response(
			`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo mailbox</title><style>body{font:20px system-ui;padding:36px;background:#f4f1e8;color:#182719}a{display:block;padding:20px;margin:24px 0;background:#d2ef9a;border-radius:18px;color:#182719;text-align:center}</style></head><body><h1>Demo mailbox</h1><p>Allow The Lounge to read this test mailbox?</p><a href="/fixture-connectors/allow?state=${state}">Allow access</a><a href="/fixture-connectors/deny?state=${state}">Decline access</a></body></html>`,
			{ headers: { "Content-Type": "text/html" } },
		);
	}
	if (
		["/fixture-connectors/allow", "/fixture-connectors/deny"].includes(
			url.pathname,
		)
	) {
		const state = url.searchParams.get("state") ?? "";
		const pending = authorizations.get(state);
		if (!pending) {
			return new Response("Authorization expired", { status: 400 });
		}
		const callback = new URL(pending.callback);
		callback.searchParams.set("state", state);
		if (url.pathname.endsWith("/deny")) {
			stats.denied++;
			callback.searchParams.set("error", "access_denied");
			authorizations.delete(state);
		} else {
			pending.code = randomBytes(16).toString("hex");
			callback.searchParams.set("code", pending.code);
		}
		return Response.redirect(callback, 302);
	}
	if (
		url.pathname === "/fixture-connectors/token" &&
		request.method === "POST"
	) {
		const query = new URLSearchParams(await request.text());
		const entry = [...authorizations].find(
			([, value]) => value.code && value.code === query.get("code"),
		);
		if (
			!entry ||
			query.get("client_id") !== "fixture-client" ||
			query.get("client_secret") !== "fixture-secret" ||
			query.get("redirect_uri") !== entry[1].callback.toString() ||
			createHash("sha256")
				.update(query.get("code_verifier") ?? "")
				.digest("base64url") !== entry[1].challenge
		) {
			return Response.json({ error: "invalid_grant" }, { status: 400 });
		}
		authorizations.delete(entry[0]);
		stats.connected++;
		return Response.json({
			access_token: "fixture-mailbox",
			token_type: "Bearer",
			expires_in: 3600,
		});
	}
	if (url.pathname.startsWith("/fixture-connectors/gmail/")) {
		if (request.headers.get("authorization") !== "Bearer fixture-mailbox") {
			return new Response("Unauthorized", { status: 401 });
		}
		stats.toolCalls++;
		if (url.searchParams.get("q") === "NATIVE_CONNECTOR_STOP") {
			await new Promise((resolve) => setTimeout(resolve, 12000));
		}
		if (url.pathname.endsWith("/fixture-message")) {
			return Response.json({
				id: "fixture-message",
				threadId: "fixture-thread",
				snippet: "A demo meeting",
				payload: {
					mimeType: "text/plain",
					headers: [{ name: "Subject", value: "Demo meeting" }],
					body: {
						data: Buffer.from("The demo meeting starts at noon.").toString(
							"base64url",
						),
					},
				},
			});
		}
		return Response.json({
			messages: [{ id: "fixture-message", threadId: "fixture-thread" }],
			resultSizeEstimate: 1,
		});
	}
	return new Response("Unknown connector fixture", { status: 404 });
}
