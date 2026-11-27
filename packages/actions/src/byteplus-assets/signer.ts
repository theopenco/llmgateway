import { createHash, createHmac } from "node:crypto";

export interface BytePlusSigningInput {
	method: string;
	url: URL;
	headers: Record<string, string>;
	body: string;
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	service: string;
	date?: Date;
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
	return createHmac("sha256", key).update(value, "utf8").digest();
}

function encodeRfc3986(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

export function deriveBytePlusSigningKey(
	secretAccessKey: string,
	shortDate: string,
	region: string,
	service: string,
): Buffer {
	return hmac(
		hmac(hmac(hmac(secretAccessKey, shortDate), region), service),
		"request",
	);
}

/** `20201230T081805Z` */
export function formatBytePlusDate(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

/**
 * Signs a BytePlus OpenAPI request (HMAC-SHA256, the scheme documented as
 * "Sign API Request" for every BytePlus OpenAPI service). Returns the headers
 * to send: the input headers plus Host, X-Date, X-Content-Sha256 and
 * Authorization.
 */
export function signBytePlusRequest(
	input: BytePlusSigningInput,
): Record<string, string> {
	const xDate = formatBytePlusDate(input.date ?? new Date());
	const shortDate = xDate.slice(0, 8);
	const payloadHash = sha256Hex(input.body);
	const headers: Record<string, string> = {
		...input.headers,
		Host: input.url.host,
		"X-Date": xDate,
		"X-Content-Sha256": payloadHash,
	};

	const canonicalHeaderEntries = Object.entries(headers)
		.map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const canonicalHeaders = canonicalHeaderEntries
		.map(([name, value]) => `${name}:${value}\n`)
		.join("");
	const signedHeaders = canonicalHeaderEntries.map(([name]) => name).join(";");

	const canonicalQuery = [...input.url.searchParams.entries()]
		.map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
		.sort(([a, av], [b, bv]) =>
			a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1,
		)
		.map(([key, value]) => `${key}=${value}`)
		.join("&");

	const canonicalRequest = [
		input.method.toUpperCase(),
		input.url.pathname || "/",
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");

	const credentialScope = `${shortDate}/${input.region}/${input.service}/request`;
	const stringToSign = [
		"HMAC-SHA256",
		xDate,
		credentialScope,
		sha256Hex(canonicalRequest),
	].join("\n");

	const signingKey = deriveBytePlusSigningKey(
		input.secretAccessKey,
		shortDate,
		input.region,
		input.service,
	);
	const signature = createHmac("sha256", signingKey)
		.update(stringToSign, "utf8")
		.digest("hex");

	return {
		...headers,
		Authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
}
