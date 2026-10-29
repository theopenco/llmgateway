/* eslint-disable no-console */
// Backfill only a legacy newsletter segment with confirmed newsletter consent.
// Requires RESEND_API_KEY, RESEND_NEWSLETTER_TOPIC_ID, RESEND_NEWSLETTER_SEGMENT_ID.
// Dry-run by default; APPLY=true writes missing preferences, never opt-outs.
// CONCURRENCY=1 by default (maximum 5).
import { fileURLToPath } from "node:url";

import { createResendClient } from "@llmgateway/shared/email";

import type { Resend } from "resend";

const CUTOFF = new Date("2026-04-01T00:00:00Z");

interface Contact {
	id: string;
	email: string;
	created_at: string;
	unsubscribed: boolean;
}

async function sleep(ms: number): Promise<void> {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
	const factor = 2 ** attempt;
	return Math.min(factor * 500, 30000);
}

async function listAllContacts(
	resend: Resend,
	segmentId: string,
): Promise<Contact[]> {
	const all: Contact[] = [];
	let after: string | undefined;
	while (true) {
		const data = await requestWithRetry(() =>
			resend.contacts.list({
				segmentId,
				limit: 100,
				...(after ? { after } : {}),
			}),
		);
		all.push(...data.data);
		if (!data.has_more) {
			return all;
		}
		const next = data.data.at(-1)?.id;
		if (!next || next === after) {
			throw new Error("Resend returned an invalid contacts cursor");
		}
		after = next;
	}
}

async function setTopicOptIn(
	resend: Resend,
	id: string,
	topicId: string,
): Promise<boolean> {
	const contact = await requestWithRetry(() => resend.contacts.get({ id }));
	if (contact.unsubscribed !== false) {
		return false;
	}
	let after: string | undefined;
	while (true) {
		const topics = await requestWithRetry(() =>
			resend.contacts.topics.list({
				id,
				limit: 100,
				...(after ? { after } : {}),
			}),
		);
		// Backfill missing state only; never override an existing preference.
		if (topics.data.some((topic) => topic.id === topicId)) {
			return false;
		}
		if (!topics.has_more) {
			break;
		}
		const next = topics.data.at(-1)?.id;
		if (!next || next === after) {
			throw new Error("Resend returned an invalid topics cursor");
		}
		after = next;
	}
	await requestWithRetry(() =>
		resend.contacts.topics.update({
			id,
			topics: [{ id: topicId, subscription: "opt_in" }],
		}),
	);
	return true;
}

export async function main() {
	const apiKey = process.env.RESEND_API_KEY;
	const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
	const segmentId = process.env.RESEND_NEWSLETTER_SEGMENT_ID;
	const apply = process.env.APPLY === "true";
	const concurrency = Number(process.env.CONCURRENCY ?? "1");
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
		throw new Error("CONCURRENCY must be an integer from 1 to 5");
	}
	if (!apiKey || !topicId || !segmentId) {
		throw new Error(
			"RESEND_API_KEY, RESEND_NEWSLETTER_TOPIC_ID and RESEND_NEWSLETTER_SEGMENT_ID are required",
		);
	}
	const newsletterTopicId = topicId;
	const resend = createResendClient(apiKey, 10_000);
	console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
	const contacts = await listAllContacts(resend, segmentId);
	const eligible = contacts.filter(
		(contact) =>
			contact.unsubscribed === false && new Date(contact.created_at) < CUTOFF,
	);
	console.log(`Eligible legacy newsletter contacts: ${eligible.length}`);
	if (!apply) {
		console.log("Dry-run only. No contacts modified.");
		return;
	}
	let next = 0;
	let done = 0;
	let skipped = 0;
	let failed = 0;
	async function worker() {
		while (next < eligible.length) {
			const contact = eligible[next++];
			try {
				if (await setTopicOptIn(resend, contact.id, newsletterTopicId)) {
					done++;
				} else {
					skipped++;
				}
			} catch {
				failed++;
				console.error(
					"Contact backfill failed; rerun after checking Resend availability.",
				);
			}
		}
	}
	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	console.log(
		`Done. Subscribed: ${done}. Skipped: ${skipped}. Failed: ${failed}.`,
	);
	if (failed > 0) {
		process.exitCode = 1;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	void main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "Newsletter backfill failed",
		);
		process.exitCode = 1;
	});
}
async function requestWithRetry<T>(
	request: () => Promise<{
		data: T | null;
		error: { statusCode: number | null; message: string } | null;
	}>,
): Promise<T> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const { data, error } = await request();
		if (!error && data) {
			return data;
		}
		const retryable =
			error &&
			(error.statusCode === null ||
				error.statusCode === 429 ||
				error.statusCode >= 500);
		if (!retryable || attempt === 4) {
			throw new Error(
				`Resend request failed (status ${error?.statusCode ?? "unknown"})`,
			);
		}
		await sleep(backoffMs(attempt));
	}
	throw new Error("Resend retry limit exceeded");
}
