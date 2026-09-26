import { RequestError } from "./request-error.js";

export class RedirectError extends RequestError {
	public constructor() {
		super(
			"URL redirects are not allowed for security reasons. Use the final URL directly.",
		);
		this.name = "RedirectError";
	}
}

/** Fetch without redirects, preserving policy rejections as client errors. */
export async function fetchNoRedirect(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	try {
		return await fetch(input, { ...init, redirect: "error" });
	} catch (error) {
		let cause: unknown = error;
		for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
			if (
				cause.message === "unexpected redirect" ||
				cause.message === "fetch failed: unexpected redirect"
			) {
				throw new RedirectError();
			}
			cause = cause.cause;
		}
		throw error;
	}
}
