import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const versionedUrlCache = new Map<string, string>();

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
