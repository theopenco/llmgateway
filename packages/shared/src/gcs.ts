import { Storage } from "@google-cloud/storage";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 900;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let storageClient: Storage | null = null;

export interface ParsedGcsUri {
	bucket: string;
	objectPath: string;
}

function getStorageClient(): Storage {
	const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
	storageClient ??= projectId ? new Storage({ projectId }) : new Storage();

	return storageClient;
}

function getNormalizedObjectPath(path: string): string {
	return path
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0)
		.join("/");
}

function encodeObjectPath(path: string): string {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

export function parseGcsUri(
	uri: string | null | undefined,
): ParsedGcsUri | null {
	if (!uri || !uri.startsWith("gs://")) {
		return null;
	}

	const withoutScheme = uri.slice("gs://".length);
	const slashIndex = withoutScheme.indexOf("/");
	if (slashIndex === -1) {
		return null;
	}

	const bucket = withoutScheme.slice(0, slashIndex).trim();
	const objectPath = getNormalizedObjectPath(
		withoutScheme.slice(slashIndex + 1),
	);
	if (!bucket || !objectPath) {
		return null;
	}

	return {
		bucket,
		objectPath,
	};
}

export function buildGcsUri(bucket: string, objectPath: string): string {
	const normalizedPath = getNormalizedObjectPath(objectPath);
	return `gs://${bucket}/${normalizedPath}`;
}

export function buildVertexVideoOutputStorageUri(input: {
	bucket: string;
	prefix?: string | null;
	organizationId: string;
	projectId: string;
	videoJobId: string;
}): string {
	const pathSegments = [
		input.prefix ?? null,
		input.organizationId,
		input.projectId,
		input.videoJobId,
	]
		.filter((segment): segment is string => Boolean(segment && segment.trim()))
		.map((segment) => segment.trim());

	return buildGcsUri(input.bucket, `${pathSegments.join("/")}/`);
}

export function getGoogleVertexVideoOutputBucket(): string | null {
	const value = process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET?.trim();
	return value && value.length > 0 ? value : null;
}

export function getGoogleVertexVideoOutputPrefix(): string | null {
	const value = process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_PREFIX?.trim();
	return value && value.length > 0 ? value : null;
}

export function getGoogleVertexSignedUrlTtlSeconds(): number {
	const rawValue = process.env.LLM_GOOGLE_VERTEX_SIGNED_URL_TTL_SECONDS?.trim();
	if (!rawValue) {
		return DEFAULT_SIGNED_URL_TTL_SECONDS;
	}

	const parsed = Number(rawValue);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_SIGNED_URL_TTL_SECONDS;
	}

	return Math.floor(parsed);
}

export function getVideoStorageExpiryDate(createdAt = new Date()): Date {
	return new Date(createdAt.getTime() + ONE_DAY_MS);
}

function getTestSignedUrl(uri: string, ttlSeconds: number): string {
	const parsed = parseGcsUri(uri);
	if (!parsed) {
		throw new Error("Invalid GCS URI");
	}

	const baseUrl =
		process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL?.trim() ??
		"https://storage.googleapis.com";

	return `${baseUrl.replace(/\/$/, "")}/${parsed.bucket}/${encodeObjectPath(parsed.objectPath)}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=${ttlSeconds}&X-Goog-Signature=test`;
}

export async function createSignedGcsReadUrl(
	uri: string | null | undefined,
	ttlSeconds = getGoogleVertexSignedUrlTtlSeconds(),
): Promise<string | null> {
	const parsed = parseGcsUri(uri);
	if (!parsed) {
		return null;
	}

	if (process.env.NODE_ENV === "test") {
		return getTestSignedUrl(
			buildGcsUri(parsed.bucket, parsed.objectPath),
			ttlSeconds,
		);
	}

	const ttlMilliseconds = ttlSeconds * 1_000;
	const expiresAt = Date.now() + ttlMilliseconds;

	const [signedUrl] = await getStorageClient()
		.bucket(parsed.bucket)
		.file(parsed.objectPath)
		.getSignedUrl({
			version: "v4",
			action: "read",
			expires: expiresAt,
		});

	return signedUrl;
}
