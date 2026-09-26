import { createHash } from "node:crypto";

import { db } from "@llmgateway/db";
import {
	getCompliantProvidersForModel,
	isLiveMapping,
	type ModelMappingAvailability,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";
import {
	decryptProviderKey,
	encryptProviderKey,
} from "@llmgateway/shared/provider-key-crypto";

import { fetchNoRedirect } from "./fetch-no-redirect.js";

import type { OrganizationNotificationChannelKind } from "@llmgateway/db";

const SLACK_WEBHOOK_PATTERN =
	/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;
const SLACK_TIMEOUT_MS = 10_000;

/** Only Slack incoming webhooks are accepted; the fixed host is the SSRF guard. */
export function isSlackWebhookUrl(url: string): boolean {
	return SLACK_WEBHOOK_PATTERN.test(url);
}

export function maskSlackWebhookUrl(url: string): string {
	return `https://hooks.slack.com/services/…${url.slice(-4)}`;
}

export function encryptNotificationChannelConfig(
	config: string,
	channelId: string,
	organizationId: string,
): string {
	return encryptProviderKey(config, channelId, organizationId);
}

export function decryptNotificationChannelConfig(
	ciphertext: string,
	channelId: string,
	organizationId: string,
): string {
	return decryptProviderKey(ciphertext, channelId, organizationId);
}

export interface AlertContent {
	title: string;
	message: string;
	href: string;
}

function absoluteUrl(href: string): string {
	return `${process.env.UI_URL ?? "https://llmgateway.io"}${href}`;
}

/** Posts an alert to a Slack incoming webhook. Throws on any non-2xx reply. */
export async function sendSlackAlert(
	webhookUrl: string,
	alert: AlertContent,
): Promise<void> {
	if (!isSlackWebhookUrl(webhookUrl)) {
		throw new Error("Invalid Slack webhook URL");
	}
	const url = absoluteUrl(alert.href);
	const res = await fetchNoRedirect(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
		body: JSON.stringify({
			text: `${alert.title}\n${alert.message}\n${url}`,
			blocks: [
				{
					type: "section",
					text: { type: "mrkdwn", text: `*${alert.title}*\n${alert.message}` },
				},
				{
					type: "actions",
					elements: [
						{
							type: "button",
							text: { type: "plain_text", text: "Open LLM Gateway" },
							url,
						},
					],
				},
			],
		}),
	});
	if (!res.ok) {
		throw new Error(
			`Slack webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
		);
	}
}

/** Senders per org channel kind; adding a channel means adding a sender here. */
export const notificationChannelSenders: Record<
	OrganizationNotificationChannelKind,
	(config: string, alert: AlertContent) => Promise<void>
> = {
	slack: sendSlackAlert,
};

/** Stable hash of a policy, so the worker can tell policy edits from catalogue changes. */
export function hashCompliancePolicy(policy: ProviderCompliancePolicy): string {
	const normalize = (value: unknown): unknown =>
		Array.isArray(value)
			? [...value].sort()
			: value && typeof value === "object"
				? Object.fromEntries(
						Object.entries(value)
							.filter(([, v]) => v !== undefined)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([k, v]) => [k, normalize(v)]),
					)
				: value;
	return createHash("sha256")
		.update(JSON.stringify(normalize(policy)))
		.digest("hex")
		.slice(0, 16);
}

async function loadActiveMappings(modelIds: readonly string[]) {
	return await db.query.modelProviderMapping.findMany({
		columns: {
			modelId: true,
			providerId: true,
			deprecatedAt: true,
			deactivatedAt: true,
		},
		where: { modelId: { in: [...modelIds] }, status: "active" },
	});
}

/** Models with no mapping still served at `now`; they can never become available. */
export async function getModelsWithoutLiveMapping(
	modelIds: readonly string[],
	now: Date = new Date(),
): Promise<string[]> {
	if (!modelIds.length) {
		return [];
	}
	const mappings = await loadActiveMappings(modelIds);
	const live = new Set(
		mappings.filter((m) => isLiveMapping(m, now)).map((m) => m.modelId),
	);
	return modelIds.filter((id) => !live.has(id));
}

/**
 * Compliant providers per model, evaluated against active catalogue and
 * Airside mappings.
 */
export async function getModelAvailability(
	modelIds: readonly string[],
	policy: ProviderCompliancePolicy,
	now: Date = new Date(),
): Promise<Map<string, string[]>> {
	const result = new Map<string, string[]>();
	if (!modelIds.length) {
		return result;
	}
	const mappings = await loadActiveMappings(modelIds);
	const byModel = new Map<string, ModelMappingAvailability[]>();
	for (const mapping of mappings) {
		const list = byModel.get(mapping.modelId) ?? [];
		list.push(mapping);
		byModel.set(mapping.modelId, list);
	}
	for (const modelId of modelIds) {
		result.set(
			modelId,
			getCompliantProvidersForModel(
				modelId,
				byModel.get(modelId) ?? [],
				policy,
				now,
			),
		);
	}
	return result;
}
