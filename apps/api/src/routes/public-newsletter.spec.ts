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
