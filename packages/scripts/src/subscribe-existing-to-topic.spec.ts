import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { main } from "./subscribe-existing-to-topic.js";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	listTopics: vi.fn(),
	updateTopics: vi.fn(),
}));

vi.mock("@llmgateway/shared/email", () => ({
	createResendClient: () => ({
		contacts: {
			list: mocks.list,
			get: mocks.get,
			topics: { list: mocks.listTopics, update: mocks.updateTopics },
		},
	}),
}));

const contact = {
	id: "legacy-contact",
	email: "reader@example.com",
	created_at: "2026-03-01T00:00:00Z",
	unsubscribed: false,
};
const page = (data: unknown[], has_more = false) => ({
	data: { data, has_more },
	error: null,
});
const failure = (statusCode: number | null) => ({
	data: null,
	error: { statusCode, message: contact.email },
});

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("RESEND_API_KEY", "test-key");
	vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "newsletter-topic");
	vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "legacy-newsletter");
	vi.stubEnv("APPLY", "true");
	vi.stubEnv("CONCURRENCY", "1");
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	mocks.list.mockResolvedValue(page([contact]));
	mocks.get.mockResolvedValue({ data: contact, error: null });
	mocks.listTopics.mockResolvedValue(page([]));
	mocks.updateTopics.mockResolvedValue({
		data: { id: contact.id },
		error: null,
	});
});

afterEach(() => {
	process.exitCode = 0;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe("newsletter backfill", () => {
	test("requires an explicit consented newsletter segment", async () => {
		vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "");
		await expect(main()).rejects.toThrow("RESEND_NEWSLETTER_SEGMENT_ID");
		expect(mocks.list).not.toHaveBeenCalled();
	});

	test.each(["0", "-1", "bad", "1.5", "6"])(
		"rejects invalid concurrency %s",
		async (value) => {
			vi.stubEnv("CONCURRENCY", value);
			await expect(main()).rejects.toThrow("CONCURRENCY");
			expect(mocks.list).not.toHaveBeenCalled();
		},
	);

	test("defaults to dry-run and never prints addresses", async () => {
		vi.stubEnv("APPLY", undefined);
		await main();
		expect(mocks.list).toHaveBeenCalledWith({
			segmentId: "legacy-newsletter",
			limit: 100,
		});
		expect(mocks.get).not.toHaveBeenCalled();
		expect(mocks.updateTopics).not.toHaveBeenCalled();
		expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
			contact.email,
		);
	});

	test("only opts in old, explicitly globally subscribed contacts", async () => {
		mocks.list.mockResolvedValue(
			page([
				contact,
				{ ...contact, id: "unsubscribed", unsubscribed: true },
				{ ...contact, id: "missing-status", unsubscribed: undefined },
				{ ...contact, id: "cutoff", created_at: "2026-04-01T00:00:00Z" },
				{ ...contact, id: "invalid-date", created_at: "invalid" },
			]),
		);
		await main();
		expect(mocks.get).toHaveBeenCalledTimes(1);
		expect(mocks.updateTopics).toHaveBeenCalledExactlyOnceWith({
			id: contact.id,
			topics: [{ id: "newsletter-topic", subscription: "opt_in" }],
		});
	});

	test.each(["opt_out", "opt_in"])(
		"preserves existing topic preference %s",
		async (subscription) => {
			mocks.listTopics.mockResolvedValue(
				page([{ id: "newsletter-topic", subscription }]),
			);
			await main();
			expect(mocks.updateTopics).not.toHaveBeenCalled();
		},
	);

	test("rechecks global unsubscribe before writing", async () => {
		mocks.get.mockResolvedValue({
			data: { ...contact, unsubscribed: true },
			error: null,
		});
		await main();
		expect(mocks.listTopics).not.toHaveBeenCalled();
		expect(mocks.updateTopics).not.toHaveBeenCalled();
	});

	test("finds topic opt-outs on later pages", async () => {
		mocks.listTopics
			.mockResolvedValueOnce(
				page([{ id: "other-topic", subscription: "opt_in" }], true),
			)
			.mockResolvedValueOnce(
				page([{ id: "newsletter-topic", subscription: "opt_out" }]),
			);
		await main();
		expect(mocks.listTopics).toHaveBeenLastCalledWith({
			id: contact.id,
			limit: 100,
			after: "other-topic",
		});
		expect(mocks.updateTopics).not.toHaveBeenCalled();
	});

	test("paginates within the consented segment", async () => {
		mocks.list
			.mockResolvedValueOnce(page([contact], true))
			.mockResolvedValueOnce(page([]));
		await main();
		expect(mocks.list).toHaveBeenLastCalledWith({
			segmentId: "legacy-newsletter",
			limit: 100,
			after: contact.id,
		});
		expect(mocks.updateTopics).toHaveBeenCalledTimes(1);
	});

	test.each([429, 503, null])(
		"retries transient status %s for reads and idempotent writes",
		async (status) => {
			vi.useFakeTimers();
			mocks.list.mockResolvedValueOnce(failure(status));
			mocks.updateTopics.mockResolvedValueOnce(failure(status));
			const run = main();
			await vi.runAllTimersAsync();
			await run;
			expect(mocks.list).toHaveBeenCalledTimes(2);
			expect(mocks.updateTopics).toHaveBeenCalledTimes(2);
		},
	);

	test("bounds retries and exits nonzero without leaking provider messages", async () => {
		vi.useFakeTimers();
		mocks.updateTopics.mockResolvedValue(failure(429));
		const run = main();
		await vi.runAllTimersAsync();
		await run;
		expect(mocks.updateTopics).toHaveBeenCalledTimes(5);
		expect(process.exitCode).toBe(1);
		expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
			contact.email,
		);
	});

	test("fails closed on topic read errors", async () => {
		mocks.listTopics.mockResolvedValue(failure(403));
		await main();
		expect(mocks.updateTopics).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	test("rejects malformed pagination instead of reporting success", async () => {
		mocks.list.mockResolvedValue(page([], true));
		await expect(main()).rejects.toThrow("cursor");
		expect(mocks.updateTopics).not.toHaveBeenCalled();
	});
});
