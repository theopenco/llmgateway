import { redisClient } from "@llmgateway/cache";
import {
	and,
	db,
	gte,
	inArray,
	providerKeyHourlyStats,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	FAILING_CREDENTIAL_ERROR_RATE,
	FAILING_CREDENTIAL_MIN_REQUESTS,
	FAILING_CREDENTIAL_WINDOW_HOURS,
	failingCredentialWindowStart,
	getFailingCredentialRate,
	MODEL_ERROR_RATE_ALERTS_SETTING_ID,
	postDiscordWebhook,
} from "@llmgateway/shared";

import type { DiscordWebhookPayload } from "@llmgateway/shared";

const DISCORD_TIMEOUT_MS = 5_000;
const MAX_LISTED_CREDENTIALS = 10;
const CRITICAL_COLOR = 0xef4444;
/** Discord rejects the whole message when an embed field name exceeds this. */
const DISCORD_FIELD_NAME_LIMIT = 256;

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
/** One alert per credential per window: a dead key stays dead until someone acts. */
const COOLDOWN_SECONDS = FAILING_CREDENTIAL_WINDOW_HOURS * 60 * 60;

export interface FailingCredential {
	id: string;
	provider: string;
	comment: string | null;
	requestCount: number;
	errorsCount: number;
	errorRate: number;
}

export function credentialCooldownKey(providerKeyId: string): string {
	return `failing_credential_alert:${providerKeyId}`;
}

/** Active managed credentials failing nearly every request, worst first. */
export async function findFailingCredentials(): Promise<FailingCredential[]> {
	const keys = await db.query.providerKey.findMany({
		where: { managed: { eq: true }, status: { eq: "active" } },
		columns: { id: true, provider: true, comment: true },
	});
	if (keys.length === 0) {
		return [];
	}

	const stats = providerKeyHourlyStats;
	const rows = await db
		.select({
			providerKeyId: stats.providerKeyId,
			requestCount: sql<string>`coalesce(sum(${stats.requestCount}), 0)::bigint`,
			clientErrorCount: sql<string>`coalesce(sum(${stats.clientErrorCount}), 0)::bigint`,
			gatewayErrorCount: sql<string>`coalesce(sum(${stats.gatewayErrorCount}), 0)::bigint`,
			upstreamErrorCount: sql<string>`coalesce(sum(${stats.upstreamErrorCount}), 0)::bigint`,
		})
		.from(stats)
		.where(
			and(
				inArray(
					stats.providerKeyId,
					keys.map((key) => key.id),
				),
				gte(stats.hourTimestamp, failingCredentialWindowStart()),
			),
		)
		.groupBy(stats.providerKeyId);

	const keysById = new Map(keys.map((key) => [key.id, key]));
	return rows
		.flatMap((row) => {
			const key = keysById.get(row.providerKeyId);
			const failing =
				key &&
				getFailingCredentialRate({
					logsCount: Number(row.requestCount),
					clientErrorsCount: Number(row.clientErrorCount),
					gatewayErrorsCount: Number(row.gatewayErrorCount),
					upstreamErrorsCount: Number(row.upstreamErrorCount),
				});
			return key && failing ? [{ ...key, ...failing }] : [];
		})
		.sort((a, b) => b.errorRate - a.errorRate || b.errorsCount - a.errorsCount);
}

export function buildFailingCredentialsPayload(
	credentials: FailingCredential[],
	adminUrl: string | undefined,
): DiscordWebhookPayload {
	const base = adminUrl?.replace(/\/$/, "");
	const listed = credentials.slice(0, MAX_LISTED_CREDENTIALS);
	const lines = [
		`${credentials.length} managed provider ${credentials.length === 1 ? "credential is" : "credentials are"} failing at least ${FAILING_CREDENTIAL_ERROR_RATE}% of requests over the last ${FAILING_CREDENTIAL_WINDOW_HOURS}h (min ${FAILING_CREDENTIAL_MIN_REQUESTS} requests). Likely revoked or out of credit: deactivate or replace it.`,
	];
	if (credentials.length > listed.length) {
		lines.push(`+${credentials.length - listed.length} more not listed.`);
	}
	return {
		embeds: [
			{
				title: "Failing provider credentials",
				...(base ? { url: `${base}/provider-credentials?errors=4h` } : {}),
				description: lines.join("\n"),
				color: CRITICAL_COLOR,
				fields: listed.map((credential) => ({
					name: truncate(
						`${credential.provider} · ${credential.comment || credential.id}`,
						DISCORD_FIELD_NAME_LIMIT,
					),
					value: `**${credential.errorRate.toFixed(1)}%** · ${credential.errorsCount}/${credential.requestCount} requests${
						base
							? ` · [open](${base}/provider-credentials/${encodeURIComponent(credential.id)})`
							: ` · ${credential.id}`
					}`,
				})),
				timestamp: new Date().toISOString(),
			},
		],
	};
}

/**
 * Posts newly failing managed credentials to the model error-rate Discord
 * channel. Mapping-level alerts miss a dead key: routing retries its requests
 * on the next credential, so the mapping's own error rate stays low.
 */
export async function checkFailingCredentialAlerts(): Promise<void> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: MODEL_ERROR_RATE_ALERTS_SETTING_ID },
	});
	const webhookUrl = process.env.MODEL_ERROR_RATE_DISCORD_URL;
	if (!setting?.enabled || !webhookUrl) {
		return;
	}

	const fresh: FailingCredential[] = [];
	try {
		for (const credential of await findFailingCredentials()) {
			const reserved = await redisClient.set(
				credentialCooldownKey(credential.id),
				"1",
				"EX",
				COOLDOWN_SECONDS,
				"NX",
			);
			if (reserved === "OK") {
				fresh.push(credential);
			}
		}
		if (fresh.length === 0) {
			return;
		}
		await postDiscordWebhook(
			webhookUrl,
			buildFailingCredentialsPayload(fresh, process.env.ADMIN_URL),
			{ timeoutMs: DISCORD_TIMEOUT_MS },
		);
	} catch (error) {
		// Release the cooldowns so the next tick retries the delivery.
		if (fresh.length > 0) {
			await redisClient.del(
				...fresh.map((credential) => credentialCooldownKey(credential.id)),
			);
		}
		throw error;
	}
	logger.info("Sent failing provider credential alert", {
		credentials: fresh.length,
	});
}
