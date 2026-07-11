import { notFound } from "next/navigation";

import { getLLMText, source } from "@/lib/source";

export const revalidate = false;

export async function GET(
	_req: Request,
	{ params }: RouteContext<"/llms.mdx/[[...slug]]">,
) {
	const { slug } = await params;
	const page = source.getPage(slug);
	if (!page) {
		notFound();
	}

	return new Response(await getLLMText(page), {
		headers: {
			"Content-Type": "text/markdown",
			// Keep the raw-markdown mirrors fetchable for AI crawlers but out
			// of search indexes (they duplicate the HTML docs pages).
			"X-Robots-Tag": "noindex",
		},
	});
}

export function generateStaticParams() {
	return source.generateParams();
}
