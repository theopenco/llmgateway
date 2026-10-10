import { expect, test } from "vitest";

import { verificationCallback } from "./verification-callback.js";

const base = "https://example.test";
const fallback = `${base}/dashboard?emailVerified=true`;
const link = (callback: string) =>
	`https://api.example.test/auth/verify-email?callbackURL=${encodeURIComponent(callback)}`;

test("preserves a same-origin device callback and its code", () => {
	const target = `${base}/connect/device?user_code=ABCDEFGH`;
	expect(verificationCallback(link(target), base)).toBe(target);
	expect(
		verificationCallback(link("/connect/device?user_code=ABCDEFGH"), base),
	).toBe(target);
});

test.each([
	"",
	"/",
	"https://outside.example",
	"//outside.example",
	"/\\outside.example",
	"https://name:password@example.test/device",
	"https://[",
])("keeps dashboard fallback for missing or unsafe callback %s", (callback) => {
	expect(verificationCallback(link(callback), base)).toBe(fallback);
});

test("uses the originating app for the default and allowed callback", () => {
	const app = "https://other-app.example.test";
	expect(verificationCallback(link("/"), app)).toBe(
		`${app}/dashboard?emailVerified=true`,
	);
	expect(verificationCallback(link(`${base}/connect/device`), app)).toBe(
		`${app}/dashboard?emailVerified=true`,
	);
	expect(verificationCallback(link(`${app}/dashboard/setup`), app)).toBe(
		`${app}/dashboard/setup`,
	);
});
