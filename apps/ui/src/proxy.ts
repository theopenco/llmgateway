import { NextResponse } from "next/server";

import { MARKDOWN_PAGES } from "@/lib/markdown-pages";

import type { NextRequest } from "next/server";

const GATEWAY_URL =
	process.env.GATEWAY_URL ??
	(process.env.NODE_ENV === "production"
		? "https://api.llmgateway.io"
		: "http://localhost:4001");

/**
 * True when the Accept header prefers text/markdown over text/html
 * (acceptmarkdown.com). Explicit text/html outranks markdown on a tie;
 * wildcard-only html does not.
 */
function markdownPreferred(accept: string | null): boolean {
	if (!accept || !accept.includes("text/markdown")) {
		return false;
	}
	let markdownQ = 0;
	let htmlQ = 0;
	let htmlExplicit = false;
	for (const part of accept.split(",")) {
		const [type, ...params] = part.trim().split(";");
		const media = type?.trim().toLowerCase();
		let q = 1;
		for (const param of params) {
			const [key, value] = param.trim().split("=");
			if (key === "q") {
				const parsed = Number(value);
				q = Number.isNaN(parsed) ? 0 : parsed;
			}
		}
		if (media === "text/markdown") {
			markdownQ = Math.max(markdownQ, q);
		} else if (media === "text/html") {
			htmlExplicit = true;
			htmlQ = Math.max(htmlQ, q);
		} else if (media === "text/*" || media === "*/*") {
			htmlQ = Math.max(htmlQ, q);
		}
	}
	if (markdownQ <= 0) {
		return false;
	}
	return markdownQ > htmlQ || (markdownQ === htmlQ && !htmlExplicit);
}

export function proxy(request: NextRequest) {
	const { pathname, searchParams } = request.nextUrl;

	// Better Auth appends `?error=<code>` (and sometimes `?error_description=`)
	// to the post-OAuth callback URL when a social sign-in fails (e.g.
	// `account_not_linked`). If that lands on `/dashboard`, the dashboard layout
	// redirects unauthenticated users straight to `/login` and drops the query,
	// so the error is never shown. Catch it here first and forward the code to
	// the login page, which renders it as a toast.
	if (pathname.startsWith("/dashboard")) {
		const error = searchParams.get("error");
		if (!error) {
			return NextResponse.next();
		}
		const url = request.nextUrl.clone();
		url.pathname = "/login";
		const preserved = new URLSearchParams();
		preserved.set("error", error);
		const description = searchParams.get("error_description");
		if (description) {
			preserved.set("error_description", description);
		}
		url.search = preserved.toString();
		return NextResponse.redirect(url);
	}

	// MCP protocol traffic on /mcp is forwarded to the gateway's MCP server so
	// agents can connect via the primary domain; browsers still get the
	// marketing page.
	if (pathname === "/mcp") {
		const accept = request.headers.get("accept") ?? "";
		const isProtocolRequest =
			(request.method !== "GET" && request.method !== "HEAD") ||
			!accept.includes("text/html");
		if (isProtocolRequest) {
			return NextResponse.rewrite(new URL("/mcp", GATEWAY_URL));
		}
	}

	// Markdown content negotiation for pages with a markdown representation.
	// A 307 to a dedicated URL instead of a rewrite: Next.js owns the Vary
	// header on rendered pages (it cannot be extended to include Accept), so
	// serving two representations from one URL would let shared caches mix
	// them up. The 307 is uncacheable by default and carries Vary: Accept,
	// and each representation keeps its own URL.
	if (
		pathname in MARKDOWN_PAGES &&
		markdownPreferred(request.headers.get("accept"))
	) {
		const response = NextResponse.redirect(
			new URL(`/md${pathname === "/" ? "" : pathname}`, request.url),
			307,
		);
		response.headers.set("Vary", "Accept");
		return response;
	}

	return NextResponse.next();
}

export const config = {
	// All pages except Next internals, API proxies, and static files (dots).
	matcher: ["/((?!_next/|api/|ingest/|.*\\..*).*)"],
};
