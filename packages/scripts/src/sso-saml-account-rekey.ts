/* eslint-disable no-console */
/**
 * One-off: move SAML accounts still keyed by Entra's object id (the
 * `samlConfig.mapping.id` that Better Auth 1.7 removed) onto the signed NameID
 * the plugin now matches on, and drop `mapping.id` from the stored config.
 * Until then those users miss their account at sign-in and are linked by
 * email instead, which creates a new user once their email has changed.
 *
 * Per legacy account:
 *   delete-redundant  the user already has a NameID account; drop the old row
 *   rewrite           set the account to the NameID from --map, else
 *                     `<SCIM externalId>@<--name-id-domain>`
 *   conflict          another user holds that NameID (a duplicate created by
 *                     the regression); left alone, merge by hand
 *   unmapped          no NameID known; left alone, still links by email
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @llmgateway/scripts sso-saml-account-rekey \
 *     --provider <providerId> [--map <file.csv>] [--name-id-domain <domain>] [--apply]
 *
 * Flags:
 *   --provider        SSO provider id (required).
 *   --map             CSV of `<object id>,<NameID>` lines exported from the IdP.
 *   --name-id-domain  Derive the NameID from the SCIM externalId for accounts
 *                     not in --map. Only for tenants where the UPN is
 *                     `<mailNickname>@<domain>`; check against existing pairs first.
 *   --apply           Write, in one transaction. Without it nothing changes.
 */

import { readFileSync } from "node:fs";

import { and, db, eq, inArray, isNotNull, tables } from "@llmgateway/db";

import {
	parseNameIdMap,
	planRekey,
	withoutLegacyMappingId,
} from "./sso-saml-account-rekey-lib.js";

function flag(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} needs a value`);
	}
	return value;
}

async function main() {
	const providerId = flag("--provider");
	if (!providerId) {
		throw new Error("--provider is required");
	}
	const mapFile = flag("--map");
	const nameIdDomain = flag("--name-id-domain")?.toLowerCase();
	const apply = process.argv.includes("--apply");

	const provider = await db.query.ssoProvider.findFirst({
		where: { providerId: { eq: providerId } },
	});
	if (!provider?.samlConfig) {
		throw new Error(`No SAML provider ${providerId}`);
	}

	const accounts = await db
		.select({
			id: tables.account.id,
			userId: tables.account.userId,
			accountId: tables.account.accountId,
		})
		.from(tables.account)
		.where(eq(tables.account.providerId, providerId));

	const memberships = provider.organizationId
		? await db
				.select({
					userId: tables.userOrganization.userId,
					externalId: tables.userOrganization.scimExternalId,
				})
				.from(tables.userOrganization)
				.where(
					and(
						eq(tables.userOrganization.organizationId, provider.organizationId),
						isNotNull(tables.userOrganization.scimExternalId),
					),
				)
		: [];

	const actions = planRekey({
		accounts,
		nameIdByObjectId: mapFile
			? parseNameIdMap(readFileSync(mapFile, "utf8"))
			: new Map(),
		scimExternalIdByUser: new Map(
			memberships.flatMap((m) =>
				m.externalId ? [[m.userId, m.externalId] as const] : [],
			),
		),
		nameIdDomain,
	});
	const strippedConfig = withoutLegacyMappingId(provider.samlConfig);

	for (const action of actions) {
		const target = "nameId" in action ? ` -> ${action.nameId}` : "";
		const held =
			action.kind === "conflict"
				? ` (held by user ${action.heldByUserId})`
				: "";
		console.log(
			`${action.kind.padEnd(16)} user ${action.userId} ${action.objectId}${target}${held}`,
		);
	}
	const count = (kind: string) => actions.filter((a) => a.kind === kind).length;
	console.log(`\nProvider ${providerId}: ${accounts.length} accounts`);
	console.log(`delete-redundant: ${count("delete-redundant")}`);
	console.log(`rewrite:          ${count("rewrite")}`);
	console.log(`conflict:         ${count("conflict")}`);
	console.log(`unmapped:         ${count("unmapped")}`);
	console.log(
		`mapping.id:       ${strippedConfig ? "remove" : "already absent"}`,
	);

	if (!apply) {
		console.log("\nDry run: pass --apply to write.");
		return;
	}

	await db.transaction(async (tx) => {
		const redundant = actions.flatMap((a) =>
			a.kind === "delete-redundant" ? [a.accountRowId] : [],
		);
		if (redundant.length > 0) {
			await tx
				.delete(tables.account)
				.where(inArray(tables.account.id, redundant));
		}
		for (const action of actions) {
			if (action.kind === "rewrite") {
				await tx
					.update(tables.account)
					.set({ accountId: action.nameId })
					.where(
						and(
							eq(tables.account.id, action.accountRowId),
							eq(tables.account.accountId, action.objectId),
						),
					);
			}
		}
		if (strippedConfig) {
			await tx
				.update(tables.ssoProvider)
				.set({ samlConfig: strippedConfig })
				.where(eq(tables.ssoProvider.id, provider.id));
		}
	});
	console.log("\nApplied.");
}

void main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
