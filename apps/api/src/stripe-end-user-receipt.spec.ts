import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { deleteAll } from "./testing.js";

import type * as EmailModule from "./utils/email.js";
import type Stripe from "stripe";

vi.mock("./utils/email.js", async (importOriginal) => {
	const original = await importOriginal<typeof EmailModule>();
	return {
		...original,
		sendTransactionalEmail: vi.fn(),
	};
});

const { sendTransactionalEmail } = await import("./utils/email.js");
const sendEmailMock = vi.mocked(sendTransactionalEmail);

const { handleEndUserTopUpRefunded, handleEndUserTopUpSucceeded } =
	await import("./stripe.js");

const ORG_ID = "receipt-org-id";
const PROJECT_ID = "receipt-project-id";
const WALLET_ID = "receipt-wallet-id";
const CUSTOMER_ID = "receipt-customer-id";

function makeTopUpIntent(
	id: string,
	amountCents: number,
): Stripe.PaymentIntent {
	return {
		id,
		amount: amountCents,
		metadata: {
			kind: "end_user_topup",
			walletId: WALLET_ID,
			netCredited: "10",
		},
	} as unknown as Stripe.PaymentIntent;
}

async function seedWallet(opts: {
	mode: "live" | "test";
	email?: string | null;
}) {
	await db.insert(tables.endCustomer).values({
		id: CUSTOMER_ID,
		organizationId: ORG_ID,
		projectId: PROJECT_ID,
		externalId: "user_123",
		mode: opts.mode,
		email: opts.email ?? null,
		name: "Ada Lovelace",
	});

	await db.insert(tables.wallet).values({
		id: WALLET_ID,
		endCustomerId: CUSTOMER_ID,
		projectId: PROJECT_ID,
		organizationId: ORG_ID,
		mode: opts.mode,
		balance: "0",
	});
}

describe("end-user top-up receipt", () => {
	beforeEach(async () => {
		sendEmailMock.mockClear();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Receipt Org",
			billingEmail: "receipt@llmgateway.io",
			credits: "100",
		});

		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Receipt Project",
			organizationId: ORG_ID,
			endUserEnabled: true,
			endUserBrandName: "Acme AI",
			endUserSupportEmail: "support@acme.test",
			endUserStatementDescriptorSuffix: "ACME AI",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("emails the end-user a branded receipt on a live top-up", async () => {
		await seedWallet({ mode: "live", email: "ada@acme.test" });

		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_1", 1050));

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const call = sendEmailMock.mock.calls[0][0];
		expect(call.to).toBe("ada@acme.test");
		expect(call.subject).toContain("Acme AI");
		expect(call.attachments?.[0]?.filename).toMatch(/^receipt-.*\.pdf$/);
		expect(call.attachments?.[0]?.contentType).toBe("application/pdf");
		// The org-owner verified-email gate must not apply: the end-user is not a
		// member of the developer's organization.
		expect(call.organizationId).toBeUndefined();
		expect(call.html).toContain("Acme AI");
		expect(call.html).toContain("support@acme.test");
		expect(call.html).toContain("merchant of record");
		// The email must quote the descriptor the cardholder actually sees, not
		// our bare prefix.
		expect(call.html).toContain("LLMGTWY* ACME AI");
	});

	test("falls back to the bare prefix when no descriptor is configured", async () => {
		await db
			.update(tables.project)
			.set({ endUserStatementDescriptorSuffix: null })
			.where(eq(tables.project.id, PROJECT_ID));
		await seedWallet({ mode: "live", email: "ada@acme.test" });

		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_6", 1050));

		const call = sendEmailMock.mock.calls[0][0];
		expect(call.html).toContain("<strong>LLMGTWY</strong>");
		expect(call.html).not.toContain("LLMGTWY*");
	});

	test("does not email twice for a redelivered payment intent", async () => {
		await seedWallet({ mode: "live", email: "ada@acme.test" });

		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_dup", 1050));
		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_dup", 1050));

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
	});

	test("skips the receipt when the end customer has no email", async () => {
		await seedWallet({ mode: "live", email: null });

		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_2", 1050));

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	test("skips the receipt for a sandbox wallet", async () => {
		await seedWallet({ mode: "test", email: "ada@acme.test" });

		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_3", 1050));

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	test("falls back to the project name when no brand is configured", async () => {
		await db
			.update(tables.project)
			.set({ endUserBrandName: null, endUserSupportEmail: null })
			.where(eq(tables.project.id, PROJECT_ID));
		await seedWallet({ mode: "live", email: "ada@acme.test" });

		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_4", 1050));

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0].subject).toContain("Receipt Project");
	});

	test("emails a credit note when the top-up is refunded", async () => {
		await seedWallet({ mode: "live", email: "ada@acme.test" });
		await handleEndUserTopUpSucceeded(makeTopUpIntent("pi_receipt_5", 1050));
		sendEmailMock.mockClear();

		const topUpRow = await db.query.walletLedger.findFirst({
			where: {
				stripePaymentIntentId: { eq: "pi_receipt_5" },
				type: { eq: "topup" },
			},
		});
		await handleEndUserTopUpRefunded(topUpRow!);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const call = sendEmailMock.mock.calls[0][0];
		expect(call.to).toBe("ada@acme.test");
		expect(call.subject).toContain("refund");
		expect(call.attachments?.[0]?.filename).toMatch(/^credit-note-.*\.pdf$/);
	});
});
