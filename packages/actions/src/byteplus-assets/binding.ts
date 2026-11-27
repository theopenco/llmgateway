import { and, asc, db, eq, isNull, tables } from "@llmgateway/db";

import {
	decryptAssetCredentials,
	type BytePlusAssetCredentials,
} from "./credentials.js";

import type { PortraitCredentialSource } from "@llmgateway/db";

/**
 * The BytePlus account a portrait group lives in: an organization's own
 * ByteDance key ("byok") or one of LLM Gateway's managed credentials
 * ("platform"). providerKeyId is only null once that key was hard-deleted.
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
 * The managed credential new platform portraits bind to: the first active
 * default-variant, all-region managed ByteDance credential with an access key
 * pair, so any organization's credits traffic may use it. Null when LLM
 * Gateway has none.
 */
export async function resolvePlatformPortraitBinding(): Promise<PortraitCredentialBinding | null> {
	const [row] = await db
		.select({ id: tables.providerKey.id })
		.from(tables.providerKey)
		.innerJoin(
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
				eq(tables.providerKey.variant, "default"),
				isNull(tables.providerKey.region),
			),
		)
		.orderBy(asc(tables.providerKey.createdAt), asc(tables.providerKey.id))
		.limit(1);
	return row ? { source: "platform", providerKeyId: row.id } : null;
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
		throw new PortraitCredentialError(
			"The ByteDance account for this portrait no longer exists",
		);
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
