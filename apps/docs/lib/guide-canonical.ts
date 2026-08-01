// Guides are published on both hosts with the same content:
// docs.llmgateway.io/guides/* and llmgateway.io/guides/*. The marketing site
// is the primary copy (indexed, in its sitemap, receives the traffic), so
// shared guides canonicalize cross-domain to it instead of competing with it.
// Docs-only guides without a marketing-site counterpart stay self-canonical —
// add new docs-only guide slugs here, otherwise their canonical points at a
// 404 on the marketing site.
const docsOnlyGuideSlugs = new Set(["agent-skills"]);

// Docs pages that moved out of /guides/ but still mirror a marketing-site
// guide, so they keep canonicalizing to that copy.
const movedGuideCanonicals: Record<string, string> = {
	"/developers/mcp": "https://llmgateway.io/guides/mcp",
};

export function marketingGuideCanonical(pageUrl: string): string | null {
	const moved = movedGuideCanonicals[pageUrl];
	if (moved) {
		return moved;
	}
	const match = /^\/guides\/([^/]+)$/.exec(pageUrl);
	if (!match || docsOnlyGuideSlugs.has(match[1])) {
		return null;
	}
	return `https://llmgateway.io/guides/${match[1]}`;
}
