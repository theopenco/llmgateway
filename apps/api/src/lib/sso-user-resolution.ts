import { setSsoProvider } from "@/auth/sso-context.js";
import { hasSsoAccess } from "@/lib/sso-access.js";
import { emailMatchesSsoDomains } from "@/lib/sso-domains.js";

import { db } from "@llmgateway/db";

import type { SSOOptions } from "@better-auth/sso";

export const resolveSsoUser: NonNullable<SSOOptions["resolveUser"]> = async (
	input,
	context,
) => {
	const provider = await context.database.findOne<{
		organizationId: string | null;
		domain: string;
		domainVerified: boolean | null;
	}>({
		model: "ssoProvider",
		where: [{ field: "providerId", value: input.providerId }],
	});
	if (
		!provider?.organizationId ||
		!provider.domainVerified ||
		!emailMatchesSsoDomains(input.providerUser.email, provider.domain)
	) {
		return { action: "reject", code: "sso_email_domain_mismatch" };
	}
	const organization = await db.query.organization.findFirst({
		where: { id: { eq: provider.organizationId } },
	});
	if (
		!organization ||
		organization.status === "deleted" ||
		!hasSsoAccess(organization)
	) {
		return { action: "reject", code: "sso_unavailable" };
	}
	const account = await context.database.findOne<{ userId: string }>({
		model: "account",
		where: [
			{ field: "providerId", value: input.providerId },
			{ field: "accountId", value: input.accountKey.accountId },
		],
	});
	if (account) {
		const owner = await context.database.findOne<{ email: string }>({
			model: "user",
			where: [{ field: "id", value: account.userId }],
		});
		if (!owner || !emailMatchesSsoDomains(owner.email, provider.domain)) {
			return { action: "reject", code: "sso_email_domain_mismatch" };
		}
	}
	setSsoProvider(input.providerId);
	return { action: "continue" };
};
