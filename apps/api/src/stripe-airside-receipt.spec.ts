import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";

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

const { handleAirsideListingCheckout } = await import("./stripe.js");

const COMPANY_ID = "airside-receipt-company";

function makeSession(opts: {
	id: string;
	paymentStatus: Stripe.Checkout.Session["payment_status"];
	email?: string | null;
}): Stripe.Checkout.Session {
	return {
		id: opts.id,
		payment_status: opts.paymentStatus,
		amount_total: 49900,
		currency: "usd",
		customer_email: opts.email ?? null,
		customer_details: opts.email ? { email: opts.email } : null,
		metadata: {
			type: "airside_listing_fee",
			providerCompanyId: COMPANY_ID,
		},
	} as unknown as Stripe.Checkout.Session;
}

describe("airside listing fee receipt", () => {
	beforeEach(async () => {
		sendEmailMock.mockClear();

		await db.insert(tables.providerCompany).values({
			id: COMPANY_ID,
			name: "Nimbus Compute",
			paymentStatus: "unpaid",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("emails a receipt once the listing fee is paid", async () => {
		await handleAirsideListingCheckout(
			makeSession({
				id: "cs_airside_1",
				paymentStatus: "paid",
				email: "ops@nimbus.test",
			}),
		);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const call = sendEmailMock.mock.calls[0][0];
		expect(call.to).toBe("ops@nimbus.test");
		expect(call.subject).toContain("Airside listing fee");
		expect(call.attachments?.[0]?.filename).toBe("receipt-cs_airside_1.pdf");
		// Carriers are not organization members, so the org-owner verified gate
		// must not be applied to them.
		expect(call.organizationId).toBeUndefined();
		// The listing fee is a direct LLM Gateway purchase, so it gets a plain
		// receipt — no merchant-of-record explanation, no statement descriptor.
		expect(call.html).not.toContain("merchant of record");
		expect(call.html).not.toContain("LLMGTWY");
		expect(call.html).toContain("For billing enquiries");
	});

	test("does not email again on a redelivered session", async () => {
		const session = makeSession({
			id: "cs_airside_dup",
			paymentStatus: "paid",
			email: "ops@nimbus.test",
		});

		await handleAirsideListingCheckout(session);
		await handleAirsideListingCheckout(session);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
	});

	test("does not email while the payment is still unsettled", async () => {
		await handleAirsideListingCheckout(
			makeSession({
				id: "cs_airside_2",
				paymentStatus: "unpaid",
				email: "ops@nimbus.test",
			}),
		);

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	test("falls back to the company owner when the session carries no email", async () => {
		await db.insert(tables.user).values({
			id: "airside-receipt-user",
			name: "Nimbus Owner",
			email: "owner@nimbus.test",
			emailVerified: true,
		});
		await db.insert(tables.providerCompanyMember).values({
			id: "airside-receipt-member",
			providerCompanyId: COMPANY_ID,
			userId: "airside-receipt-user",
			role: "owner",
		});

		await handleAirsideListingCheckout(
			makeSession({ id: "cs_airside_3", paymentStatus: "paid", email: null }),
		);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0].to).toBe("owner@nimbus.test");
	});
});
