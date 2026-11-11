/**
 * Plan for moving SAML accounts keyed by the removed `samlConfig.mapping.id`
 * (Entra's object id) onto the signed NameID that Better Auth 1.7 uses as the
 * account subject. See the 1.7 upgrade guide, "SSO account subjects are
 * protocol-defined".
 */

const OBJECT_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLegacyObjectId(accountId: string): boolean {
	return OBJECT_ID.test(accountId);
}

export interface SamlAccount {
	id: string;
	userId: string;
	accountId: string;
}

export interface RekeyInput {
	/** Every account row of one SSO provider. */
	accounts: SamlAccount[];
	/** Legacy object id -> NameID, exported from the identity provider. */
	nameIdByObjectId: Map<string, string>;
	/** User id -> SCIM externalId (Entra's mailNickname by default). */
	scimExternalIdByUser: Map<string, string>;
	/** Derive `<externalId>@<domain>` when the IdP mapping has no entry. */
	nameIdDomain?: string;
}

interface Base {
	accountRowId: string;
	userId: string;
	objectId: string;
}

export type RekeyAction =
	| (Base & { kind: "delete-redundant"; nameId: string })
	| (Base & { kind: "rewrite"; nameId: string; source: "idp" | "scim" })
	| (Base & { kind: "conflict"; nameId: string; heldByUserId: string })
	| (Base & { kind: "unmapped" });

export function planRekey(input: RekeyInput): RekeyAction[] {
	const holders = new Map<string, string>();
	for (const account of input.accounts) {
		if (!isLegacyObjectId(account.accountId)) {
			holders.set(account.accountId.toLowerCase(), account.userId);
		}
	}

	const actions: RekeyAction[] = [];
	for (const account of input.accounts) {
		if (!isLegacyObjectId(account.accountId)) {
			continue;
		}
		const base: Base = {
			accountRowId: account.id,
			userId: account.userId,
			objectId: account.accountId,
		};

		const existing = input.accounts.find(
			(other) =>
				other.userId === account.userId && !isLegacyObjectId(other.accountId),
		);
		if (existing) {
			actions.push({
				...base,
				kind: "delete-redundant",
				nameId: existing.accountId,
			});
			continue;
		}

		const fromIdp = input.nameIdByObjectId.get(account.accountId.toLowerCase());
		const externalId = input.scimExternalIdByUser.get(account.userId);
		const fromScim =
			externalId && input.nameIdDomain
				? `${externalId}@${input.nameIdDomain}`
				: undefined;
		const nameId = fromIdp ?? fromScim;
		if (!nameId) {
			actions.push({ ...base, kind: "unmapped" });
			continue;
		}

		const heldBy = holders.get(nameId.toLowerCase());
		if (heldBy && heldBy !== account.userId) {
			actions.push({ ...base, kind: "conflict", nameId, heldByUserId: heldBy });
			continue;
		}
		holders.set(nameId.toLowerCase(), account.userId);
		actions.push({
			...base,
			kind: "rewrite",
			nameId,
			source: fromIdp ? "idp" : "scim",
		});
	}
	return actions;
}

/** Parses `objectId,nameId` lines; blank lines and `#` comments are skipped. */
export function parseNameIdMap(text: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const [index, raw] of text.split(/\r?\n/).entries()) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const [objectId, nameId, ...rest] = line.split(",").map((v) => v.trim());
		if (
			!objectId ||
			!nameId ||
			rest.length > 0 ||
			!isLegacyObjectId(objectId)
		) {
			throw new Error(`Line ${index + 1}: expected "<object id>,<NameID>"`);
		}
		map.set(objectId.toLowerCase(), nameId);
	}
	return map;
}

/** Returns the stored SAML config without `mapping.id`, or null when unchanged. */
export function withoutLegacyMappingId(samlConfig: string): string | null {
	const config = JSON.parse(samlConfig) as {
		mapping?: Record<string, unknown>;
	};
	if (!config.mapping || !("id" in config.mapping)) {
		return null;
	}
	const { id: _id, ...mapping } = config.mapping;
	return JSON.stringify({ ...config, mapping });
}
