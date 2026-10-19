import { describe, expect, it } from "vitest";

import { getActiveProviderPromo, SCX_PROMO } from "./marketing";

describe("provider promo schedule", () => {
	it("shows no promo before SCX starts", () => {
		const start = Date.parse(SCX_PROMO.startsAt);
		expect(getActiveProviderPromo(start - 1)).toBeNull();
		expect(getActiveProviderPromo(start)?.id).toBe("scx");
	});

	it("shows SCX for the extended 30 days and then removes the banner", () => {
		const start = Date.parse(SCX_PROMO.startsAt);
		const end = Date.parse(SCX_PROMO.endsAt);
		const day = 24 * 60 * 60 * 1000;
		const week = 7 * day;
		const originalDuration = 15 * day;
		expect(SCX_PROMO.endsAt).toBe("2026-10-09T23:59:59.000Z");
		expect(end - start).toBe(30 * day);
		expect(getActiveProviderPromo(start + week)?.id).toBe("scx");
		expect(getActiveProviderPromo(start + originalDuration)?.id).toBe("scx");
		expect(getActiveProviderPromo(end - 1)?.id).toBe("scx");
		expect(getActiveProviderPromo(end)).toBeNull();
		expect(getActiveProviderPromo(end + 1)).toBeNull();
	});
});
