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
 * Object-id rows count as legacy only while the stored config still has
 * `mapping.id`; it is removed once no conflict or unmapped row is left, so
 * rerun after resolving those. NameIDs are compared exactly, like sign-in.
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

import { and, db, eq, inArray, isNotNull, sql, tables } from "@llmgateway/db";

import {
	canDropLegacyMapping,
	hasLegacyMappingId,
	parseNameIdMap,
	planRekey,
	withoutLegacyMappingId,
} from "./sso-saml-account-rekey-lib.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

	const nameIdByObjectId = mapFile
		? parseNameIdMap(readFileSync(mapFile, "utf8"))
		: new Map<string, string>();

	const provider = await db.query.ssoProvider.findFirst({
		where: { providerId: { eq: providerId } },
	});
	if (!provider?.samlConfig) {
		throw new Error(`No SAML provider ${providerId}`);
	}

	async function plan(tx: Tx) {
		const current = await tx.query.ssoProvider.findFirst({
			where: { providerId: { eq: providerId } },
		});
		if (!current?.samlConfig) {
			throw new Error(`No SAML provider ${providerId}`);
		}
		const accounts = await tx
			.select({
				id: tables.account.id,
				userId: tables.account.userId,
				accountId: tables.account.accountId,
			})
			.from(tables.account)
			.where(eq(tables.account.providerId, providerId!));
		const memberships = current.organizationId
			? await tx
					.select({
						userId: tables.userOrganization.userId,
						externalId: tables.userOrganization.scimExternalId,
					})
					.from(tables.userOrganization)
					.where(
						and(
							eq(
								tables.userOrganization.organizationId,
								current.organizationId,
							),
							isNotNull(tables.userOrganization.scimExternalId),
						),
					)
			: [];
		const actions = planRekey({
			accounts,
			nameIdByObjectId,
			scimExternalIdByUser: new Map(
				memberships.flatMap((m) =>
					m.externalId ? [[m.userId, m.externalId] as const] : [],
				),
			),
			nameIdDomain,
			legacyMappingActive: hasLegacyMappingId(current.samlConfig),
		});
		const strippedConfig = canDropLegacyMapping(actions)
			? withoutLegacyMappingId(current.samlConfig)
			: null;
		return { provider: current, accounts, actions, strippedConfig };
	}

	function report(result: Awaited<ReturnType<typeof plan>>) {
		const { accounts, actions, strippedConfig } = result;
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
		const count = (kind: string) =>
			actions.filter((a) => a.kind === kind).length;
		console.log(`\nProvider ${providerId}: ${accounts.length} accounts`);
		console.log(`delete-redundant: ${count("delete-redundant")}`);
		console.log(`rewrite:          ${count("rewrite")}`);
		console.log(`conflict:         ${count("conflict")}`);
		console.log(`unmapped:         ${count("unmapped")}`);
		const legacy = hasLegacyMappingId(result.provider.samlConfig ?? "{}");
		console.log(
			`mapping.id:       ${strippedConfig ? "remove" : legacy ? "keep until conflicts and unmapped rows are resolved" : "already absent"}`,
		);
	}

	if (!apply) {
		report(await db.transaction(plan));
		console.log("\nDry run: pass --apply to write.");
		return;
	}

	await db.transaction(async (tx) => {
		// Block concurrent account and SCIM membership writes (reads still pass)
		// while the plan is re-read and applied, so no NameID is linked and no
		// externalId changes in between. The lock is table-wide, so fail fast
		// instead of queueing, and write in bulk to keep it short.
		await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
		await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
		await tx.execute(
			sql`LOCK TABLE account, user_organization IN SHARE ROW EXCLUSIVE MODE`,
		);
		const result = await plan(tx);
		report(result);
		const redundant = result.actions.flatMap((a) =>
			a.kind === "delete-redundant" ? [a.accountRowId] : [],
		);
		if (redundant.length > 0) {
			await tx
				.delete(tables.account)
				.where(inArray(tables.account.id, redundant));
		}
		const rewrites = result.actions.flatMap((a) =>
			a.kind === "rewrite"
				? [sql`(${a.accountRowId}, ${a.objectId}, ${a.nameId})`]
				: [],
		);
		if (rewrites.length > 0) {
			await tx.execute(sql`
				UPDATE account AS a SET account_id = v.name_id, updated_at = now()
				FROM (VALUES ${sql.join(rewrites, sql`, `)}) AS v(id, old_id, name_id)
				WHERE a.id = v.id AND a.account_id = v.old_id
			`);
		}
		if (result.strippedConfig) {
			await tx
				.update(tables.ssoProvider)
				.set({ samlConfig: result.strippedConfig })
				.where(eq(tables.ssoProvider.id, result.provider.id));
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
