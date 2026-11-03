import { notFound } from "next/navigation";

import { docsBaseUrl } from "@/lib/base-url";
import { marketingGuideCanonical } from "@/lib/guide-canonical";
import { getLLMText, source } from "@/lib/source";

export const dynamic = "force-dynamic";

// Page text is fixed after build, so process each page once per server
// process instead of on every crawler hit (same idiom as llms-full.txt's
// memo). A failure drops the entry so the next request retries; the page
// set is bounded, so no eviction is needed.
const pageTextByUrl = new Map<string, Promise<string>>();

function getPageText(page: NonNullable<ReturnType<typeof source.getPage>>) {
	let promise = pageTextByUrl.get(page.url);
	if (!promise) {
		promise = getLLMText(page).catch((error: unknown) => {
			pageTextByUrl.delete(page.url);
			throw error;
		});
		pageTextByUrl.set(page.url, promise);
	}
	return promise;
}

export async function GET(
	_req: Request,
	{ params }: RouteContext<"/llms.mdx/[[...slug]]">,
) {
	const { slug } = await params;
	const page = source.getPage(slug);
	if (!page) {
		notFound();
	}

	return new Response(await getPageText(page), {
		headers: {
			"Content-Type": "text/markdown",
			// Keep the raw-markdown mirrors fetchable for AI crawlers but out
			// of search indexes (they duplicate the HTML docs pages).
			"X-Robots-Tag": "noindex",
			Link: `<${marketingGuideCanonical(page.url) ?? `${docsBaseUrl}${page.url}`}>; rel="canonical"`,
		},
	});
}

export function generateStaticParams() {
	return source.generateParams();
}
