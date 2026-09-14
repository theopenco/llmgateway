import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";

import {
	getApiKeyHashSecret,
	getApiKeyHashSecrets,
	getSecretKeyId,
} from "@llmgateway/shared/api-key-hash";

function key(secret: string) {
	return Buffer.from(hkdfSync("sha256", secret, "", "lounge-connector:v1", 32));
}

export function sealConnector(
	value: unknown,
	owner: string,
	id: string,
): string {
	const secret = getApiKeyHashSecret();
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
	cipher.setAAD(Buffer.from(JSON.stringify([owner, id])));
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(value), "utf8"),
		cipher.final(),
	]);
	return [
		"v1",
		getSecretKeyId(secret),
		iv.toString("base64url"),
		ciphertext.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
	].join(":");
}

export function openConnector(
	value: string,
	owner: string,
	id: string,
): unknown {
	const [version, kid, iv, ciphertext, tag, extra] = value.split(":");
	const secret = getApiKeyHashSecrets().find(
		(entry) => getSecretKeyId(entry) === kid,
	);
	if (
		version !== "v1" ||
		!secret ||
		!iv ||
		!ciphertext ||
		!tag ||
		extra !== undefined
	) {
		throw new Error("Invalid connector credentials");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(secret),
		Buffer.from(iv, "base64url"),
	);
	decipher.setAAD(Buffer.from(JSON.stringify([owner, id])));
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	return JSON.parse(
		Buffer.concat([
			decipher.update(Buffer.from(ciphertext, "base64url")),
			decipher.final(),
		]).toString("utf8"),
	);
}
