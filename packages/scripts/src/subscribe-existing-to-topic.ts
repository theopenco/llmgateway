/* eslint-disable no-console */
// Migrate existing Resend contacts onto the newsletter topic.
//
// Filters: unsubscribed === false AND created_at < CUTOFF (2026-04-01 UTC).
//
// Usage:
//   RESEND_API_KEY=re_xxx RESEND_NEWSLETTER_TOPIC_ID=uuid \
//     pnpm --filter @llmgateway/scripts subscribe-existing-to-topic
//
//   APPLY=true ...   # actually patch contacts (default is dry-run)
//   CONCURRENCY=5    # parallel PATCH workers (default 5)

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_NEWSLETTER_TOPIC_ID = process.env.RESEND_NEWSLETTER_TOPIC_ID;
const CUTOFF = new Date("2026-04-01T00:00:00Z");
const APPLY = process.env.APPLY === "true";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "5");

if (!RESEND_API_KEY) {
	console.error("RESEND_API_KEY is required");
	process.exit(1);
}
if (!RESEND_NEWSLETTER_TOPIC_ID) {
	console.error("RESEND_NEWSLETTER_TOPIC_ID is required");
	process.exit(1);
}

interface Contact {
	id: string;
	email: string;
	created_at: string;
	unsubscribed: boolean;
	first_name: string | null;
	last_name: string | null;
}

interface ListResponse {
	object: "list";
	has_more: boolean;
	data: Contact[];
}

async function listAllContacts(): Promise<Contact[]> {
	const all: Contact[] = [];
	let after: string | undefined;
	let page = 0;
	while (true) {
		const url = new URL("https://api.resend.com/contacts");
		url.searchParams.set("limit", "100");
		if (after) {
			url.searchParams.set("after", after);
		}
		const resp = await fetch(url, {
			headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
		});
		if (!resp.ok) {
			throw new Error(
				`List contacts failed: ${resp.status} ${await resp.text()}`,
			);
		}
		const json = (await resp.json()) as ListResponse;
		all.push(...json.data);
		page += 1;
		console.log(
			`Fetched page ${page}: ${json.data.length} contacts (total so far: ${all.length})`,
		);
		if (!json.has_more || json.data.length === 0) {
			break;
		}
		const last = json.data[json.data.length - 1];
		if (!last) {
			break;
		}
		after = last.id;
	}
	return all;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function patchContact(email: string, maxRetries = 8): Promise<void> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const resp = await fetch(
			`https://api.resend.com/contacts/${encodeURIComponent(email)}/topics`,
			{
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${RESEND_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([
					{
						id: RESEND_NEWSLETTER_TOPIC_ID,
						subscription: "opt_in",
					},
				]),
			},
		);
		if (resp.ok) {
			return;
		}
		if (resp.status === 429) {
			const backoff = Math.min(2 ** attempt * 500, 30000);
			await sleep(backoff);
			continue;
		}
		throw new Error(
			`PATCH ${email} failed: ${resp.status} ${await resp.text()}`,
		);
	}
	throw new Error(`PATCH ${email} failed after ${maxRetries} retries (429)`);
}

async function main() {
	console.log(
		`Mode: ${APPLY ? "APPLY (will modify contacts)" : "DRY-RUN (no changes)"}`,
	);
	console.log(`Topic: ${RESEND_NEWSLETTER_TOPIC_ID}`);
	console.log(`Cutoff: created_at < ${CUTOFF.toISOString()}`);
	console.log("");

	const contacts = await listAllContacts();
	console.log(`\nTotal contacts in account: ${contacts.length}`);

	const eligible = contacts.filter((c) => {
		if (c.unsubscribed) {
			return false;
		}
		const createdAt = new Date(c.created_at);
		return createdAt < CUTOFF;
	});

	const skippedUnsubscribed = contacts.filter((c) => c.unsubscribed).length;
	const skippedTooNew = contacts.filter(
		(c) => !c.unsubscribed && new Date(c.created_at) >= CUTOFF,
	).length;

	console.log(`Skipped (unsubscribed):  ${skippedUnsubscribed}`);
	console.log(`Skipped (created >= cutoff): ${skippedTooNew}`);
	console.log(`Eligible to subscribe:   ${eligible.length}`);

	if (eligible.length === 0) {
		console.log("\nNothing to do.");
		return;
	}

	console.log("\nFirst 10 eligible contacts:");
	for (const c of eligible.slice(0, 10)) {
		console.log(`  - ${c.email} (created ${c.created_at})`);
	}

	if (!APPLY) {
		console.log("\nDry-run only. Re-run with APPLY=true to subscribe them.");
		return;
	}

	console.log(
		`\nSubscribing ${eligible.length} contacts with concurrency ${CONCURRENCY}...`,
	);
	let done = 0;
	let failed = 0;
	const queue = [...eligible];
	async function worker() {
		while (queue.length > 0) {
			const c = queue.shift();
			if (!c) {
				return;
			}
			try {
				await patchContact(c.email);
				done += 1;
				if (done % 25 === 0) {
					console.log(`  progress: ${done}/${eligible.length}`);
				}
			} catch (err) {
				failed += 1;
				console.error(`  FAIL ${c.email}: ${(err as Error).message}`);
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

	console.log(`\nDone. Subscribed: ${done}. Failed: ${failed}.`);
}

void main().catch((err) => {
	console.error(err);
	process.exit(1);
});
