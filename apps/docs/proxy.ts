import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

const { rewrite: rewriteLLM } = rewritePath("/{/*path}", "/llms.mdx/{/*path}");

export default function proxy(request: NextRequest) {
	if (isMarkdownPreferred(request)) {
		const result = rewriteLLM(request.nextUrl.pathname);

		if (result) {
			return NextResponse.rewrite(new URL(result, request.nextUrl));
		}
	}

	return NextResponse.next();
}
