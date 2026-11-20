export interface RssItem {
	title: string;
	url: string;
	description: string;
	date: string;
}

interface RssFeed {
	title: string;
	description: string;
	siteUrl: string;
	feedUrl: string;
	items: RssItem[];
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function buildRssResponse(feed: RssFeed): Response {
	const items = [...feed.items].sort(
		(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
	);
	const lastBuildDate = items[0]
		? new Date(items[0].date).toUTCString()
		: new Date().toUTCString();
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(feed.title)}</title>
<link>${escapeXml(feed.siteUrl)}</link>
<description>${escapeXml(feed.description)}</description>
<language>en</language>
<lastBuildDate>${lastBuildDate}</lastBuildDate>
<atom:link href="${escapeXml(feed.feedUrl)}" rel="self" type="application/rss+xml"/>
${items
	.map(
		(item) => `<item>
<title>${escapeXml(item.title)}</title>
<link>${escapeXml(item.url)}</link>
<guid isPermaLink="true">${escapeXml(item.url)}</guid>
<description>${escapeXml(item.description)}</description>
<pubDate>${new Date(item.date).toUTCString()}</pubDate>
</item>`,
	)
	.join("\n")}
</channel>
</rss>
`;
	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
