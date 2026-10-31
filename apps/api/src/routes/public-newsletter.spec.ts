import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	process.env.RESEND_NEWSLETTER_TOPIC_ID = "topic-newsletter";
	return {
		consumeRateLimit: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		updateTopics: vi.fn(),
	};
});

vi.mock("@/utils/public-rate-limit.js", () => ({
	consumeRateLimit: mocks.consumeRateLimit,
}));

vi.mock("@llmgateway/shared/email", () => ({
	getResendClient: () => ({
		contacts: {
			create: mocks.create,
			update: mocks.update,
			topics: { update: mocks.updateTopics },
		},
	}),
}));

const { publicNewsletter } = await import("./public-newsletter.js");

const EMAIL = "reader@example.com";
const ok = { data: { id: "contact-1" }, error: null };

async function subscribe() {
	return await publicNewsletter.request("/subscribe", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: EMAIL }),
	});
}

describe("public newsletter subscribe", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.consumeRateLimit.mockResolvedValue(true);
		mocks.create.mockResolvedValue(ok);
		mocks.update.mockResolvedValue(ok);
		mocks.updateTopics.mockResolvedValue(ok);
	});

	test("creates the contact and opts it into the newsletter topic", async () => {
		const res = await subscribe();

		expect(res.status).toBe(200);
		expect(mocks.create).toHaveBeenCalledWith({
			email: EMAIL,
			unsubscribed: false,
		});
		expect(mocks.updateTopics).toHaveBeenCalledWith({
			email: EMAIL,
			topics: [{ id: "topic-newsletter", subscription: "opt_in" }],
		});
		expect(mocks.update).not.toHaveBeenCalled();
	});

	test("falls back to updating an existing contact when create fails", async () => {
		mocks.create.mockResolvedValue({
			data: null,
			error: { message: "Contact already exists", statusCode: 409 },
		});

		const res = await subscribe();

		expect(res.status).toBe(200);
		expect(mocks.update).toHaveBeenCalledWith({
			email: EMAIL,
			unsubscribed: false,
		});
		expect(mocks.updateTopics).toHaveBeenCalledTimes(1);
	});

	test("returns 500 without touching topics when the contact cannot be saved", async () => {
		mocks.create.mockResolvedValue({
			data: null,
			error: { message: "boom", statusCode: 500 },
		});
		mocks.update.mockResolvedValue({
			data: null,
			error: { message: "boom", statusCode: 500 },
		});

		const res = await subscribe();

		expect(res.status).toBe(500);
		expect(mocks.updateTopics).not.toHaveBeenCalled();
	});

	test("returns 500 when the topic opt-in fails", async () => {
		mocks.updateTopics.mockResolvedValue({
			data: null,
			error: { message: "Topic not found", statusCode: 404 },
		});

		const res = await subscribe();

		expect(res.status).toBe(500);
	});

	test("surfaces a Resend 429 as a 429", async () => {
		mocks.updateTopics.mockResolvedValue({
			data: null,
			error: { message: "Too many requests", statusCode: 429 },
		});

		const res = await subscribe();

		expect(res.status).toBe(429);
	});

	test("rejects callers over the local rate limit before calling Resend", async () => {
		mocks.consumeRateLimit.mockResolvedValue(false);

		const res = await subscribe();

		expect(res.status).toBe(429);
		expect(mocks.create).not.toHaveBeenCalled();
	});
});

describe("newsletter failure isolation", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.consumeRateLimit.mockResolvedValue(true);
		mocks.create.mockResolvedValue(ok);
		mocks.update.mockResolvedValue(ok);
		mocks.updateTopics.mockResolvedValue(ok);
	});

	test.each([400, 401, 403, 422, 429, 500, null])(
		"does not turn create failure %s into a subscription",
		async (statusCode) => {
			mocks.create.mockResolvedValue({
				data: null,
				error: { message: "Upstream rejected the request", statusCode },
			});
			const response = await subscribe();
			expect(response.status).toBe(statusCode === 429 ? 429 : 500);
			expect(mocks.update).not.toHaveBeenCalled();
			expect(mocks.updateTopics).not.toHaveBeenCalled();
		},
	);

	test("preserves the update failure status after a duplicate", async () => {
		mocks.create.mockResolvedValue({
			data: null,
			error: { message: "Contact already exists", statusCode: 409 },
		});
		mocks.update.mockResolvedValue({
			data: null,
			error: { message: "Too many requests", statusCode: 429 },
		});
		const response = await subscribe();
		expect(response.status).toBe(429);
		expect(mocks.updateTopics).not.toHaveBeenCalled();
	});
});

describe("newsletter retries and privacy", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.consumeRateLimit.mockResolvedValue(true);
		mocks.create.mockResolvedValue(ok);
		mocks.update.mockResolvedValue(ok);
		mocks.updateTopics.mockResolvedValue(ok);
	});

	test("returns the same success for first and repeated signups", async () => {
		const first = await subscribe();
		const repeated = await subscribe();
		expect(first.status).toBe(200);
		expect(repeated.status).toBe(200);
		expect(await repeated.json()).toEqual(await first.json());
		expect(mocks.updateTopics).toHaveBeenCalledTimes(2);
	});

	test("can retry a partial topic failure without creating a second contact", async () => {
		mocks.updateTopics.mockResolvedValueOnce({
			data: null,
			error: { message: "Unavailable", statusCode: 503 },
		});
		expect((await subscribe()).status).toBe(500);
		mocks.create.mockResolvedValueOnce({
			data: null,
			error: { message: "Contact exists", statusCode: 409 },
		});
		expect((await subscribe()).status).toBe(200);
		expect(mocks.update).toHaveBeenCalledTimes(1);
	});

	test.each(["create", "update", "updateTopics"] as const)(
		"does not leak network failures from %s",
		async (stage) => {
			if (stage === "update") {
				mocks.create.mockResolvedValue({
					data: null,
					error: { message: "Contact exists", statusCode: 409 },
				});
			}
			mocks[stage].mockRejectedValue(new Error(EMAIL));
			const response = await subscribe();
			expect(response.status).toBe(500);
			expect(await response.text()).not.toContain(EMAIL);
		},
	);

	test("validates email before any rate-limit or subscription operation", async () => {
		const response = await publicNewsletter.request("/subscribe", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "invalid" }),
		});
		expect(response.status).toBe(400);
		expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});
});
