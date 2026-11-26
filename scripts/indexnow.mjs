#!/usr/bin/env node
// Submits recently changed sitemap URLs to IndexNow (Bing, Yandex and others).
// Usage: INDEXNOW_KEY=<key> node scripts/indexnow.mjs [--days 2] [--dry-run]

const SITE_URL = process.env.INDEXNOW_SITE_URL ?? "https://llmgateway.io";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_REQUEST = 10000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysIndex = args.indexOf("--days");
const days = daysIndex === -1 ? 2 : Number(args[daysIndex + 1]);
if (!Number.isFinite(days) || days <= 0) {
	throw new Error("--days must be a positive number");
}

const key = process.env.INDEXNOW_KEY;
if (!key && !dryRun) {
	throw new Error("INDEXNOW_KEY is required");
}

const sitemapResponse = await fetch(`${SITE_URL}/sitemap.xml`);
if (!sitemapResponse.ok) {
	throw new Error(`Sitemap request failed: ${sitemapResponse.status}`);
}
const sitemap = await sitemapResponse.text();

const cutoff = Date.now() - days * MS_PER_DAY;
const urls = [];
for (const [, entry] of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
	const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
	const lastmod = entry.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
	if (!loc || !lastmod) {
		continue;
	}
	const modifiedAt = new Date(lastmod).getTime();
	if (Number.isFinite(modifiedAt) && modifiedAt >= cutoff) {
		urls.push(loc.replaceAll("&amp;", "&"));
	}
}

console.log(`${urls.length} URL(s) changed in the last ${days} day(s)`);
for (const url of urls) {
	console.log(`  ${url}`);
}
if (dryRun || urls.length === 0) {
	process.exit(0);
}

const host = new URL(SITE_URL).host;
for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json; charset=utf-8" },
		body: JSON.stringify({
			host,
			key,
			keyLocation: `${SITE_URL}/indexnow-key.txt`,
			urlList: urls.slice(i, i + MAX_URLS_PER_REQUEST),
		}),
	});
	if (!response.ok) {
		throw new Error(
			`IndexNow rejected the submission: ${response.status} ${await response.text()}`,
		);
	}
}
console.log("Submitted to IndexNow");
