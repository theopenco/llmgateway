import { beforeEach, describe, expect, test, vi } from "vitest";

import { sendTransactionalEmail } from "./email.js";

const { resendSendMock } = vi.hoisted(() => ({
	resendSendMock: vi.fn(),
}));

vi.mock("@llmgateway/db", () => ({
	isOrgOwnerEmailVerified: vi.fn(async () => true),
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock("@llmgateway/shared/email", () => ({
	fromEmail: "LLMGateway <contact@mail.llmgateway.io>",
	getResendClient: () => ({
		emails: { send: resendSendMock },
	}),
	replyToEmail: "contact@llmgateway.io",
}));

describe("sendTransactionalEmail", () => {
	beforeEach(() => {
		vi.stubEnv("NODE_ENV", "production");
		resendSendMock.mockReset();
		resendSendMock.mockResolvedValue({ data: { id: "email-id" }, error: null });
	});

	test.each([
		"admin@example.com",
		"admin@sub.example.net",
		"admin@example.org",
		"admin@example",
		"admin@invalid",
		"admin@service.test",
		"admin@localhost",
	])("skips reserved production address %s", async (to) => {
		await expect(
			sendTransactionalEmail({
				to,
				subject: "Reset your password",
				text: "Reset link",
				strict: true,
			}),
		).resolves.toBeUndefined();

		expect(resendSendMock).not.toHaveBeenCalled();
	});

	test("sends production email to a deliverable domain", async () => {
		await sendTransactionalEmail({
			to: "user@llmgateway.io",
			subject: "Reset your password",
			text: "Reset link",
			strict: true,
		});

		expect(resendSendMock).toHaveBeenCalledOnce();
	});
});
