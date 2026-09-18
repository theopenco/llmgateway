import { z } from "zod";

import { auth, acceptSession, discardSession } from "@/auth/session";
import { config } from "@/config";
import NativeLoungeAuth from "@/native/NativeLoungeAuth";

const clientId = "llmgateway-lounge-ios";
const codeSchema = z.object({
	device_code: z.string().min(1).max(4096),
	user_code: z.string().regex(/^[A-Z0-9]{8}$/),
	verification_uri_complete: z.string().url(),
	expires_in: z.number().positive().max(600),
	interval: z.number().positive().max(60),
});
export interface BrowserSignInRequest {
	deviceCode: string;
	userCode: string;
	verificationUrl: string;
	expiresAt: number;
	intervalMs: number;
}

export async function startBrowserSignIn(
	signal: AbortSignal,
): Promise<BrowserSignInRequest> {
	signal.throwIfAborted();
	const result = await auth.device.code({ client_id: clientId }, { signal });
	signal.throwIfAborted();
	if (result.error) {
		throw new Error("Browser sign-in could not start. Please try again.");
	}
	const code = codeSchema.parse(result.data);
	const url = new URL(code.verification_uri_complete);
	const account = new URL(config.accountUrl);
	if (
		url.origin !== account.origin ||
		url.pathname !== "/connect/device" ||
		url.username ||
		url.password ||
		url.hash ||
		url.searchParams.getAll("user_code").length !== 1 ||
		url.searchParams.get("user_code") !== code.user_code ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["localhost", "127.0.0.1"].includes(url.hostname)
			))
	) {
		throw new Error("The sign-in address is invalid. Please try again.");
	}
	const lifetimeMs = code.expires_in * 1000;
	return {
		deviceCode: code.device_code,
		userCode: code.user_code,
		verificationUrl: url.toString(),
		expiresAt: Date.now() + lifetimeMs,
		intervalMs: code.interval * 1000,
	};
}

function waitForPoll(ms: number, signal: AbortSignal) {
	signal.throwIfAborted();
	return new Promise<void>((resolve, reject) => {
		const cancel = () => {
			clearTimeout(timer);
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new Error("Sign-in cancelled."),
			);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", cancel);
			resolve();
		}, ms);
		signal.addEventListener("abort", cancel, { once: true });
	});
}

export async function completeBrowserSignIn(
	request: BrowserSignInRequest,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const remaining = request.expiresAt - Date.now();
	if (remaining <= 0) {
		throw new Error("Your sign-in code expired. Get a new code and try again.");
	}
	const controller = new AbortController();
	const cancel = () => controller.abort(signal.reason);
	signal.addEventListener("abort", cancel, { once: true });
	const timeout = setTimeout(
		() =>
			controller.abort(
				new Error("Your sign-in code expired. Get a new code and try again."),
			),
		remaining,
	);
	let closing = false;
	let ownsBrowser = true;
	try {
		// The token arrives through polling. A browser callback never authenticates us.
		void NativeLoungeAuth.open(request.verificationUrl).then(
			() => {
				if (!closing) {
					controller.abort(new Error("Sign-in was closed. Please try again."));
				}
			},
			(error: unknown) => {
				if (
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "AUTH_BUSY"
				) {
					ownsBrowser = false;
				}
				if (!closing) {
					controller.abort(
						error instanceof Error ? error : new Error("Sign-in cancelled."),
					);
				}
			},
		);
		let interval = request.intervalMs;
		for (;;) {
			await waitForPoll(interval, controller.signal);
			const result = await auth.device.token(
				{
					client_id: clientId,
					device_code: request.deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				},
				{ signal: controller.signal },
			);
			if (result.data?.access_token) {
				const token = result.data.access_token;
				closing = true;
				clearTimeout(timeout);
				NativeLoungeAuth.cancel();
				ownsBrowser = false;
				try {
					controller.signal.throwIfAborted();
					return await acceptSession(token, signal);
				} catch (error) {
					await discardSession(token);
					throw error;
				}
			}
			controller.signal.throwIfAborted();
			switch (result.error?.error) {
				case "authorization_pending":
					break;
				case "slow_down":
					interval += 5000;
					break;
				case "access_denied":
					throw new Error("You declined this sign-in request.");
				case "expired_token":
					throw new Error(
						"Your sign-in code expired. Get a new code and try again.",
					);
				default:
					throw new Error(
						"Sign-in could not finish. Get a new code and try again.",
					);
			}
		}
	} finally {
		closing = true;
		clearTimeout(timeout);
		signal.removeEventListener("abort", cancel);
		if (ownsBrowser) {
			NativeLoungeAuth.cancel();
		}
	}
}
