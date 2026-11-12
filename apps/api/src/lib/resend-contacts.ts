import { z } from "zod";

import { logger } from "@llmgateway/logger";
import { resendFetch, type ResendCall } from "@llmgateway/shared/resend-api";

// These run inside a request, so a slow Resend must not hold it for long.
const TIMEOUT_MS = 5_000;
const PAGE_SIZE = 100;

/** The account a contact call is made for, with its address. */
export interface ContactOwner {
	email: string;
	emailVerified: boolean;
}

// A contact as read before a move. Without its `unsubscribed` the move stops:
// guessing would bring an unsubscribed member back as subscribed. Names and
// properties are carried where they can be read and never stop a move.
const storedContact = z.object({
	unsubscribed: z.boolean(),
	first_name: z.unknown(),
	last_name: z.unknown(),
	properties: z.unknown(),
});
const storedProperty = z.object({
	value: z.union([z.string(), z.number()]).nullish(),
});

/** A lookup's `{ key: { value } }` as the `{ key: value }` a create takes. */
function carriedProperties(
	properties: unknown,
	email: string,
): Record<string, string | number> {
	const carried: Record<string, string | number> = {};
	const unread: string[] = [];
	for (const [key, entry] of Object.entries(properties ?? {})) {
		const { success, data } = storedProperty.safeParse(entry);
		if (!success) {
			unread.push(key);
		} else if (data.value !== null && data.value !== undefined) {
			carried[key] = data.value;
		}
	}
	if (unread.length > 0) {
		logger.warn("Resend contact properties left behind by a move", {
			email,
			properties: unread,
		});
	}
	return carried;
}

function ownName(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

export interface ContactFields {
	name?: string | null;
	attributes?: Record<string, string | number | boolean>;
}

type Send = (
	method: ResendCall["method"],
	path: string,
	body?: unknown,
) => Promise<Response>;

export function resendContactPath(email: string): string {
	return `/contacts/${encodeURIComponent(email)}`;
}

/** Throws Resend's own message for a response that is not a success. */
export async function expectResendOk(response: Response): Promise<Response> {
	if (!response.ok) {
		const body = (await response.json()) as { message?: string };
		throw new Error(body.message ?? `Resend API error: ${response.status}`);
	}
	return response;
}

/** Name and properties in the shape Resend's contact endpoints take. */
function toBody({ name, attributes }: ContactFields) {
	const [firstName, ...rest] = name?.split(" ") ?? [];
	const lastName = rest.join(" ");
	// Resend stores strings and numbers, so booleans go as strings.
	const properties = Object.fromEntries(
		Object.entries(attributes ?? {}).map(([key, value]) => [
			key,
			typeof value === "boolean" ? String(value) : value,
		]),
	);
	return {
		...(firstName && { first_name: firstName }),
		...(lastName && { last_name: lastName }),
		...(Object.keys(properties).length > 0 && { properties }),
	};
}

async function listAll<T>(send: Send, path: string): Promise<T[]> {
	const response = await expectResendOk(
		await send("GET", `${path}?limit=${PAGE_SIZE}`),
	);
	const page = (await response.json()) as { data: T[]; has_more: boolean };
	if (page.has_more) {
		throw new Error(`More than ${PAGE_SIZE} rows on ${path}`);
	}
	return page.data;
}

/**
 * Most users are not contacts: only an address that opted in, or signed up
 * before contacts became opt-in, has one. An unverified address may belong to
 * somebody else, contact included, so nothing is done for it. A mailing list
 * problem is logged and never reaches the caller.
 */
async function sync(
	action: string,
	{ email, emailVerified }: ContactOwner,
	run: (send: Send) => Promise<void>,
): Promise<void> {
	if (!emailVerified) {
		return;
	}
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		logger.debug(`RESEND_API_KEY not configured, skipping contact ${action}`);
		return;
	}
	try {
		await run(
			async (method, path, body) =>
				await resendFetch({
					apiKey,
					method,
					path,
					body,
					timeoutMs: TIMEOUT_MS,
				}),
		);
	} catch (error) {
		logger.error(`Resend contact ${action} failed`, {
			...(error instanceof Error ? { err: error } : { error }),
			email,
		});
	}
}

export async function updateResendContact(
	owner: ContactOwner,
	fields: ContactFields,
): Promise<void> {
	const { email } = owner;
	await sync("update", owner, async (send) => {
		const response = await send(
			"PATCH",
			resendContactPath(email),
			toBody(fields),
		);
		if (response.status === 404) {
			logger.debug("No Resend contact to update", { email });
			return;
		}
		await expectResendOk(response);
	});
}

export async function deleteResendContact(owner: ContactOwner): Promise<void> {
	const { email } = owner;
	await sync("deletion", owner, async (send) => {
		const response = await send("DELETE", resendContactPath(email));
		if (response.status === 404) {
			logger.debug("No Resend contact to delete", { email });
			return;
		}
		await expectResendOk(response);
		logger.info("Deleted Resend contact", { email });
	});
}

/**
 * Carries a contact to a new address with its unsubscribe, topics and
 * segments. A contact already at the new address keeps its own preferences.
 * The old contact is removed only once the new address has one.
 */
export async function moveResendContact(
	owner: ContactOwner,
	to: string,
	fields: ContactFields,
): Promise<void> {
	const from = owner.email;
	await sync("move", owner, async (send) => {
		const oldPath = resendContactPath(from);
		const current = await send("GET", oldPath);
		if (current.status === 404) {
			logger.debug("No Resend contact to move", { email: from });
			return;
		}
		const contact = storedContact.parse(
			await (await expectResendOk(current)).json(),
		);
		const target = await send("GET", resendContactPath(to));
		if (target.status === 404) {
			const topics = await listAll<{ id: string; subscription: string }>(
				send,
				`${oldPath}/topics`,
			);
			const segments = await listAll<{ id: string }>(
				send,
				`${oldPath}/segments`,
			);
			// The account's name and properties win; what it does not set is
			// carried over from the old contact.
			const account = toBody(fields);
			const properties = {
				...carriedProperties(contact.properties, from),
				...account.properties,
			};
			const firstName = ownName(contact.first_name);
			const lastName = ownName(contact.last_name);
			await expectResendOk(
				await send("POST", "/contacts", {
					email: to,
					...(!fields.name && firstName && { first_name: firstName }),
					...(!fields.name && lastName && { last_name: lastName }),
					...account,
					...(Object.keys(properties).length > 0 && { properties }),
					unsubscribed: contact.unsubscribed,
					...(topics.length > 0 && {
						topics: topics.map(({ id, subscription }) => ({
							id,
							subscription,
						})),
					}),
					...(segments.length > 0 && {
						segments: segments.map(({ id }) => ({ id })),
					}),
				}),
			);
		} else {
			await expectResendOk(target);
		}
		await expectResendOk(await send("DELETE", oldPath));
		logger.info("Moved Resend contact", { from, to });
	});
}
