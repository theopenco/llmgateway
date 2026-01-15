import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

const { rewrite: rewriteLLM } = rewritePath("/{/*path}", "/llms.mdx/{/*path}");

export default function proxy(request: NextRequest) {
	if (isMarkdownPreferred(request)) {
		if (request.nextUrl.pathname === "/") {
			return NextResponse.rewrite(new URL("/llms.mdx/index", request.nextUrl));
		}

		if (
			request.nextUrl.pathname === "/llms.mdx" ||
			request.nextUrl.pathname === "/llms.mdx/"
		) {
			return NextResponse.redirect(new URL("/llms.mdx/index", request.nextUrl));
		}

		// Avoid rewriting already-rewritten markdown routes
		if (request.nextUrl.pathname.startsWith("/llms.mdx/")) {
			return NextResponse.next();
		}

		const result = rewriteLLM(request.nextUrl.pathname);

		if (result) {
			return NextResponse.rewrite(new URL(result, request.nextUrl));
		}
	}

	return NextResponse.next();
}
