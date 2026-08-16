import { describe, expect, it } from "vitest";

import { detectPii, redactPii } from "./pii.js";

const clean = [
	'{"product_id": 123456789, "qty": 3}',
	'{"product_id": 3074185296}',
	"product_id=3074185296",
	"order 987654321 shipped, tracking 1234567890",
	"created_at 1755302400 updated_at 1755302401",
	"epoch ms 1755302400123",
	"Total revenue 4123456789012 cents",
	"card token 4111111111111112",
	"Version 1.2.3.4 released",
	"upgrade to v10.0.0.1",
	"coordinates 1.2.3.4.5",
	"Employee record AB1234567 archived",
	"Flight LH123456 to Berlin",
	"Invoice PO1234567 total",
	"Part number X12345 out of stock",
	"SKU 000-00-0000 discontinued",
];

const detected = [
	["SSN", "his ssn is 123-45-6789"],
	["Credit Card", "card 4111111111111111 expires soon"],
	["Email", "ping support@example.com about it"],
	["Phone", "call me at 555-123-4567"],
	["Phone", "reception: (415) 555-0100"],
	["Phone", "phone 4155550100"],
	["IP Address", "client connected from 203.0.113.42"],
	["Passport", "passport AB1234567 expires in May"],
	["Drivers License", "driver's license D1234567 on file"],
] as const;

describe("detectPii", () => {
	it.each(clean)("does not flag %j", (content) => {
		expect(detectPii(content).patterns).toEqual([]);
	});

	it.each(detected)("flags %s in %j", (label, content) => {
		expect(detectPii(content).patterns).toContain(label);
	});
});

describe("redactPii", () => {
	it("leaves numeric identifiers untouched", () => {
		const content = '{"product_id": 3074185296, "created_at": 1755302400}';
		expect(redactPii(content).redacted).toBe(content);
	});

	it("redacts each detected value in place", () => {
		const result = redactPii(
			"mail bob@example.com or call 555-123-4567, ssn 123-45-6789",
		);
		expect(result.redacted).toBe(
			"mail [EMAIL_REDACTED] or call [PHONE_REDACTED], ssn [SSN_REDACTED]",
		);
	});

	it("redacts a card number once, not as overlapping matches", () => {
		const result = redactPii("card 4111111111111111 on file");
		expect(result.redacted).toBe("card [CREDIT_CARD_REDACTED] on file");
		expect(result.patterns).toEqual(["Credit Card"]);
	});

	it("reports the same detections as the rule check", () => {
		const content = "email a@b.io and phone (415) 555-0100";
		expect(redactPii(content).patterns).toEqual(detectPii(content).patterns);
	});
});
