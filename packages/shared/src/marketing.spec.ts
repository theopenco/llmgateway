import { describe, expect, it } from "vitest";

import { getActiveProviderPromo, RUNWARE_PROMO, SCX_PROMO } from "./marketing";

describe("provider promo schedule", () => {
	it("hands over from Runware to SCX at the existing cutoff", () => {
		const cutoff = Date.parse(RUNWARE_PROMO.endsAt);
		expect(getActiveProviderPromo(cutoff - 1)?.id).toBe("runware");
		expect(getActiveProviderPromo(cutoff)?.id).toBe("scx");
		expect(getActiveProviderPromo(cutoff + 1)?.id).toBe("scx");
	});

	it("shows SCX for exactly 15 days and then removes the banner", () => {
		const start = Date.parse(SCX_PROMO.startsAt);
		const end = Date.parse(SCX_PROMO.endsAt);
		const week = 7 * 24 * 60 * 60 * 1000;
		expect(end - start).toBe(15 * 24 * 60 * 60 * 1000);
		expect(getActiveProviderPromo(start + week)?.id).toBe("scx");
		expect(getActiveProviderPromo(end - 1)?.id).toBe("scx");
		expect(getActiveProviderPromo(end)).toBeNull();
		expect(getActiveProviderPromo(end + 1)).toBeNull();
	});
});
