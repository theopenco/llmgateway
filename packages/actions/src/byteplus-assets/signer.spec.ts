import { describe, expect, it } from "vitest";

import { deriveBytePlusSigningKey, signBytePlusRequest } from "./signer.js";

describe("signBytePlusRequest", () => {
	// Public example credentials from the BytePlus "Sign API Request" guide.
	const accessKeyId = [
		"AKLTMjI2ODVlYzI3ZGY1NGU4ZjhjYWRj",
		"MTlmNTM5OTZkYzE",
	].join("");
	const secretAccessKey = [
		"TnpCak5XWXpZV1U0WkRaaE5ERmxaR0Zp",
		"TmpjeVkyUXlZek0wTWpJMU1qWQ==",
	].join("");

	it("derives the documented signing key", () => {
		expect(
			deriveBytePlusSigningKey(
				secretAccessKey,
				"20201230",
				"ap-singapore-1",
				"rtc",
			).toString("hex"),
		).toBe("aa6c033b312f2984f152589a7b015852909f850a150ba517ae8dea394126af08");
	});

	it("signs the documented example request", () => {
		const headers = signBytePlusRequest({
			method: "GET",
			url: new URL(
				"https://open.byteplusapi.com/?Action=GetRecordTask&Version=2022-06-01&AppId=Your_AppId&RoomId=Your_RoomId&TaskId=Your_TaskId",
			),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
			},
			body: "",
			accessKeyId,
			secretAccessKey,
			region: "ap-singapore-1",
			service: "rtc",
			date: new Date("2020-12-30T08:18:05Z"),
		});

		// The guide's published signature (0d7e689b…) was computed over a
		// canonical request with a typo in its x-content-sha256 line; the key
		// derivation above and this value use the correct empty-body hash.
		expect(headers["X-Date"]).toBe("20201230T081805Z");
		expect(headers.Authorization).toBe(
			`HMAC-SHA256 Credential=${accessKeyId}/20201230/ap-singapore-1/rtc/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=7ef427992ca7cc973a1defecb9fbbe4ef660cb4f7fb14ccbefa7f0d5e9008eb8`,
		);
	});
});
