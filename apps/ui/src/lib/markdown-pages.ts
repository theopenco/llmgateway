/**
 * Pages with a markdown representation for `Accept: text/markdown` content
 * negotiation (acceptmarkdown.com). Maps pathname → file under `public/`.
 * Shared by the middleware (edge, path check only) and the `/md` route
 * handler (reads the file).
 */
export const MARKDOWN_PAGES: Record<string, string> = {
	"/": "llms.txt",
	"/pricing": "pricing.md",
};
