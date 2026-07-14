import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const versionedUrlCache = new Map<string, string>();

/**
 * Appends the deployment version (`?v=<APP_VERSION>`) to a URL of a
 * dynamically generated image route (e.g. Next.js `opengraph-image`
 * routes), so browsers and social-media crawlers re-fetch the image after
 * every deploy. Next.js only busts these URLs when the route file itself
 * changes, not when an imported template or the model catalogue changes,
 * so a per-deploy version is the only stamp that always tracks the
 * rendered output. Without APP_VERSION set (local dev), or when the URL
 * already carries a query string, the URL is returned unchanged.
 */
export function withDeployVersion(url: string): string {
	const version = process.env.APP_VERSION;
	if (!version || url.includes("?")) {
		return url;
	}
	return `${url}?v=${encodeURIComponent(version)}`;
}

/**
 * Appends a content-hash query param (`?v=<hash>`) to a root-relative URL of
 * an asset in the app's `public/` directory, so browsers and social-media
 * crawlers automatically re-fetch the asset whenever its file content
 * changes (e.g. OpenGraph images). Server-only: reads the file from disk.
 *
 * External URLs, URLs that already carry a query string, and paths that
 * don't resolve to an existing file are returned unchanged.
 */
export function withAssetVersion(
	assetUrl: string,
	publicDir: string = path.join(process.cwd(), "public"),
): string {
	if (!assetUrl.startsWith("/") || assetUrl.includes("?")) {
		return assetUrl;
	}

	const filePath = path.join(publicDir, assetUrl);
	const cached = versionedUrlCache.get(filePath);
	if (cached) {
		return cached;
	}

	if (!existsSync(filePath)) {
		return assetUrl;
	}

	const hash = createHash("sha256")
		.update(readFileSync(filePath))
		.digest("hex")
		.slice(0, 10);
	const versionedUrl = `${assetUrl}?v=${hash}`;
	versionedUrlCache.set(filePath, versionedUrl);
	return versionedUrl;
}
