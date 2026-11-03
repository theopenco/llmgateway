import { fetchSafeUserContentUrl } from "@llmgateway/shared/url-safety-node";

import { RequestError } from "./request-error.js";

export class RedirectError extends RequestError {
	public constructor() {
		super(
			"URL redirects are not allowed for security reasons. Use the final URL directly.",
		);
		this.name = "RedirectError";
	}
}

function isRedirectRejection(error: unknown): boolean {
	let cause: unknown = error;
	for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
		if (
			cause.message === "unexpected redirect" ||
			cause.message === "fetch failed: unexpected redirect"
		) {
			return true;
		}
		cause = cause.cause;
	}
	return false;
}

/** Fetch without redirects, preserving policy rejections as client errors. */
export async function fetchNoRedirect(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	try {
		return await fetch(input, { ...init, redirect: "error" });
	} catch (error) {
		if (isRedirectRejection(error)) {
			throw new RedirectError();
		}
		throw error;
	}
}

/**
 * Fetch a user-supplied content URL through the DNS-pinned SSRF guard
 * (`fetchSafeUserContentUrl`), preserving redirect rejections as client errors
 * like `fetchNoRedirect`.
 */
export async function fetchSafeContentNoRedirect(
	url: string,
	init?: RequestInit,
): Promise<Response> {
	try {
		return await fetchSafeUserContentUrl(url, init);
	} catch (error) {
		if (isRedirectRejection(error)) {
			throw new RedirectError();
		}
		throw error;
	}
}
