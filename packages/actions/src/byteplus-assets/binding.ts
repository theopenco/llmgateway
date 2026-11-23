import { and, db, eq, tables } from "@llmgateway/db";

import {
	decryptAssetCredentials,
	getPlatformEnvAssetCredentials,
	type BytePlusAssetCredentials,
} from "./credentials.js";

import type { PortraitCredentialSource } from "@llmgateway/db";

/**
 * The BytePlus account a portrait group lives in: an organization's own
 * ByteDance key, a managed credential, or (platform with no key) the
 * environment credential.
 */
export interface PortraitCredentialBinding {
	source: PortraitCredentialSource;
	providerKeyId: string | null;
}

export class PortraitCredentialError extends Error {
	public constructor(
		message: string,
		public readonly status: 400 | 404 = 400,
	) {
		super(message);
		this.name = "PortraitCredentialError";
	}
}

async function loadAssetCredentialRow(providerKeyId: string) {
	const [row] = await db
		.select()
		.from(tables.providerKeyAssetCredential)
		.where(eq(tables.providerKeyAssetCredential.providerKeyId, providerKeyId))
		.limit(1);
	return row;
}

/**
 * The platform binding new platform portraits use: the first active managed
 * ByteDance credential with an access key pair, else the environment pair when
 * no managed ByteDance credential exists (managed credentials supersede the
 * environment). Null when LLM Gateway has no BytePlus access key configured.
 */
export async function resolvePlatformPortraitBinding(): Promise<PortraitCredentialBinding | null> {
	const managed = await db
		.select({
			id: tables.providerKey.id,
			hasAssetCredentials: tables.providerKeyAssetCredential.id,
		})
		.from(tables.providerKey)
		.leftJoin(
			tables.providerKeyAssetCredential,
			eq(
				tables.providerKeyAssetCredential.providerKeyId,
				tables.providerKey.id,
			),
		)
		.where(
			and(
				eq(tables.providerKey.managed, true),
				eq(tables.providerKey.provider, "bytedance"),
				eq(tables.providerKey.status, "active"),
			),
		)
		.orderBy(tables.providerKey.createdAt, tables.providerKey.id);
	const withCredentials = managed.find((row) => row.hasAssetCredentials);
	if (withCredentials) {
		return { source: "platform", providerKeyId: withCredentials.id };
	}
	if (managed.length === 0 && getPlatformEnvAssetCredentials()) {
		return { source: "platform", providerKeyId: null };
	}
	return null;
}

/**
 * Access key pair for a binding, after checking that the bound provider key is
 * still the kind of credential the binding claims and, for BYOK, that it
 * belongs to the organization.
 */
export async function resolvePortraitAssetCredentials(
	binding: PortraitCredentialBinding,
	organizationId: string,
): Promise<BytePlusAssetCredentials> {
	if (!binding.providerKeyId) {
		if (binding.source !== "platform") {
			throw new PortraitCredentialError("A BYOK portrait needs a provider key");
		}
		const env = getPlatformEnvAssetCredentials();
		if (!env) {
			throw new PortraitCredentialError(
				"LLM Gateway's BytePlus asset credentials are not configured",
			);
		}
		return env;
	}

	const key = await db.query.providerKey.findFirst({
		where: { id: { eq: binding.providerKeyId } },
	});
	const ownedCorrectly =
		binding.source === "byok"
			? key?.organizationId === organizationId && !key.managed
			: key?.managed === true;
	if (!key || !ownedCorrectly || key.provider !== "bytedance") {
		throw new PortraitCredentialError("ByteDance provider key not found", 404);
	}
	if (key.status !== "active") {
		throw new PortraitCredentialError(
			"The ByteDance provider key for this portrait is not active",
		);
	}
	const row = await loadAssetCredentialRow(key.id);
	if (!row) {
		throw new PortraitCredentialError(
			binding.source === "byok"
				? "Add a BytePlus access key pair to this ByteDance provider key first"
				: "LLM Gateway's BytePlus asset credentials are not configured",
		);
	}
	return decryptAssetCredentials(row);
}
