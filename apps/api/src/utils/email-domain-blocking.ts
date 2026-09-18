import { z } from "zod";

import { db, tables } from "@llmgateway/db";

const SETTING_ID = "blocked_signup_email_domains";

export const blockedEmailDomainSchema = z
	.string()
	.trim()
	.toLowerCase()
	.max(253)
	.regex(
		/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
		"Enter a domain such as example.com, without an email address, URL or wildcard.",
	);

export async function getBlockedSignupEmailDomains(): Promise<string[]> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: SETTING_ID },
	});
	return setting?.enabled && setting.value ? setting.value.split(",") : [];
}

export async function setBlockedSignupEmailDomains(
	domains: string[],
): Promise<string[]> {
	const normalized = [
		...new Set(domains.map((domain) => blockedEmailDomainSchema.parse(domain))),
	];
	const values = {
		enabled: normalized.length > 0,
		value: normalized.join(","),
	};
	await db
		.insert(tables.systemSetting)
		.values({ id: SETTING_ID, ...values })
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: { ...values, updatedAt: new Date() },
		});
	return normalized;
}
