import {
	decryptProviderKey,
	encryptProviderKey,
} from "@/provider-key/crypto.js";
import { providerKeyEncryptionScope } from "@/provider-key/read.js";

import { maskToken } from "@llmgateway/shared/mask-token";

export const DEFAULT_BYTEPLUS_ASSET_REGION = "ap-southeast-1";
export const DEFAULT_BYTEPLUS_ASSET_PROJECT = "default";

/** Access key pair plus the scope the BytePlus Assets API calls run in. */
export interface BytePlusAssetCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	projectName: string;
}

export interface BytePlusAccessKeyPair {
	accessKeyId: string;
	secretAccessKey: string;
}

// Domain-separated row scopes: a provider key's token ciphertext can never be
// replayed as its asset credentials or verification token, or vice versa.
function assetCredentialRowScope(rowId: string): string {
	return `${rowId}:asset-credentials`;
}

function verificationTokenRowScope(groupId: string): string {
	return `${groupId}:verification`;
}

export function encryptAssetCredentials(
	pair: BytePlusAccessKeyPair,
	rowId: string,
	organizationId: string | null,
): { credentialsCiphertext: string; accessKeyIdMasked: string } {
	return {
		credentialsCiphertext: encryptProviderKey(
			JSON.stringify({
				accessKeyId: pair.accessKeyId,
				secretAccessKey: pair.secretAccessKey,
			}),
			assetCredentialRowScope(rowId),
			providerKeyEncryptionScope(organizationId),
		),
		accessKeyIdMasked: maskToken(pair.accessKeyId),
	};
}

export function decryptAssetCredentials(row: {
	id: string;
	organizationId: string | null;
	credentialsCiphertext: string;
	region: string;
	projectName: string;
}): BytePlusAssetCredentials {
	const parsed: unknown = JSON.parse(
		decryptProviderKey(
			row.credentialsCiphertext,
			assetCredentialRowScope(row.id),
			providerKeyEncryptionScope(row.organizationId),
		),
	);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("accessKeyId" in parsed) ||
		!("secretAccessKey" in parsed) ||
		typeof parsed.accessKeyId !== "string" ||
		typeof parsed.secretAccessKey !== "string"
	) {
		throw new Error(
			`provider_key_asset_credential ${row.id}: malformed payload`,
		);
	}
	return {
		accessKeyId: parsed.accessKeyId,
		secretAccessKey: parsed.secretAccessKey,
		region: row.region,
		projectName: row.projectName,
	};
}

export function encryptVerificationToken(
	token: string,
	groupId: string,
	organizationId: string,
): string {
	return encryptProviderKey(
		token,
		verificationTokenRowScope(groupId),
		organizationId,
	);
}

export function decryptVerificationToken(
	ciphertext: string,
	groupId: string,
	organizationId: string,
): string {
	return decryptProviderKey(
		ciphertext,
		verificationTokenRowScope(groupId),
		organizationId,
	);
}
