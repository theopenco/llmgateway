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
	/** The stored config still has `mapping.id`, so object-id rows are legacy. */
	legacyMappingActive: boolean;
}

/** Strip `mapping.id` only once no legacy row is left to resolve. */
export function canDropLegacyMapping(actions: RekeyAction[]): boolean {
	return actions.every(
		(a) => a.kind === "delete-redundant" || a.kind === "rewrite",
	);
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
	// Without the legacy mapping, an object-id-shaped account id is a NameID the
	// IdP asserts today, not a stale key.
	if (!input.legacyMappingActive) {
		return [];
	}

	// Exact match, like Better Auth's account lookup at sign-in. Account ids are
	// not unique per provider, so keep every holder.
	const holders = new Map<string, Set<string>>();
	const hold = (nameId: string, userId: string) => {
		const set = holders.get(nameId) ?? new Set<string>();
		set.add(userId);
		holders.set(nameId, set);
	};
	for (const account of input.accounts) {
		if (!isLegacyObjectId(account.accountId)) {
			hold(account.accountId, account.userId);
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

		const fromIdp = input.nameIdByObjectId.get(account.accountId.toLowerCase());
		const externalId = input.scimExternalIdByUser.get(account.userId);
		const fromScim =
			externalId && input.nameIdDomain
				? `${externalId}@${input.nameIdDomain}`
				: undefined;
		const candidate = fromIdp ?? fromScim;
		// An object-id-shaped target can't be told apart from another legacy
		// key, so it may collide with a row this plan leaves alone. Resolve such
		// accounts by hand.
		const nameId =
			candidate && !isLegacyObjectId(candidate) ? candidate : undefined;

		if (!nameId) {
			const existing = input.accounts.find(
				(other) =>
					other.userId === account.userId && !isLegacyObjectId(other.accountId),
			);
			actions.push(
				existing
					? { ...base, kind: "delete-redundant", nameId: existing.accountId }
					: { ...base, kind: "unmapped" },
			);
			continue;
		}

		const heldBy = [...(holders.get(nameId) ?? [])];
		const other = heldBy.find((userId) => userId !== account.userId);
		if (other) {
			actions.push({ ...base, kind: "conflict", nameId, heldByUserId: other });
			continue;
		}
		if (heldBy.length > 0) {
			actions.push({ ...base, kind: "delete-redundant", nameId });
			continue;
		}
		hold(nameId, account.userId);
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
export function hasLegacyMappingId(samlConfig: string): boolean {
	const config = JSON.parse(samlConfig) as {
		mapping?: Record<string, unknown>;
	};
	return !!config.mapping && "id" in config.mapping;
}

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
