export interface FakeContact {
	unsubscribed: boolean;
	topics: Record<string, string>;
	segments: string[];
}

export interface FakeContacts {
	contacts: Map<string, FakeContact>;
	/** The bodies of the contacts created, in order. */
	created: Record<string, unknown>[];
	/** The updates sent, in order, with the address each went to. */
	updated: { email: string; body: unknown }[];
	/** How calls fail: a dropped connection or a rate limit. */
	failure?: "down" | "rate-limited";
	/** Only calls with this method fail; every call when unset. */
	failOn?: string;
	fetch: typeof fetch;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Resend's contact endpoints over an in-memory list, with the bodies the real
 * API answers. Requests to any other host go to `passThrough`.
 */
export function fakeResendContacts(passThrough: typeof fetch): FakeContacts {
	const fake: FakeContacts = {
		contacts: new Map(),
		created: [],
		updated: [],
		fetch: async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.origin !== "https://api.resend.com") {
				return await passThrough(input, init);
			}
			const method = init?.method ?? "GET";
			if (fake.failure && (!fake.failOn || fake.failOn === method)) {
				if (fake.failure === "down") {
					throw new TypeError("fetch failed");
				}
				return json(
					{
						statusCode: 429,
						name: "rate_limit_exceeded",
						message: "Too many requests",
					},
					429,
				);
			}
			const [, resource, rawEmail, child] = url.pathname.split("/");
			if (resource !== "contacts") {
				throw new Error(`Unexpected request: ${method} ${url.pathname}`);
			}
			if (method === "POST" && !rawEmail) {
				const body = JSON.parse(String(init?.body)) as {
					email: string;
					unsubscribed?: boolean;
					topics?: { id: string; subscription: string }[];
					segments?: { id: string }[];
				};
				if (fake.contacts.has(body.email)) {
					return json(
						{ statusCode: 409, message: "Contact already exists" },
						409,
					);
				}
				fake.created.push(body);
				fake.contacts.set(body.email, {
					unsubscribed: body.unsubscribed === true,
					topics: Object.fromEntries(
						(body.topics ?? []).map((topic) => [topic.id, topic.subscription]),
					),
					segments: (body.segments ?? []).map((segment) => segment.id),
				});
				return json({ object: "contact", id: body.email });
			}
			const address = decodeURIComponent(rawEmail ?? "");
			const contact = fake.contacts.get(address);
			if (!contact) {
				return json(
					{ statusCode: 404, name: "not_found", message: "Contact not found" },
					404,
				);
			}
			if (method === "GET" && !child) {
				return json({
					object: "contact",
					email: address,
					unsubscribed: contact.unsubscribed,
				});
			}
			if (method === "GET" && child === "topics") {
				return json({
					object: "list",
					data: Object.entries(contact.topics).map(([id, subscription]) => ({
						id,
						name: id,
						subscription,
					})),
					has_more: false,
				});
			}
			if (method === "GET" && child === "segments") {
				return json({
					object: "list",
					data: contact.segments.map((id) => ({ id, name: id })),
					has_more: false,
				});
			}
			if (method === "PATCH" && !child) {
				fake.updated.push({
					email: address,
					body: JSON.parse(String(init?.body)),
				});
				return json({ object: "contact", id: address });
			}
			if (method === "DELETE" && !child) {
				fake.contacts.delete(address);
				return json({ object: "contact", contact: address, deleted: true });
			}
			throw new Error(`Unexpected request: ${method} ${url.pathname}`);
		},
	};
	return fake;
}
