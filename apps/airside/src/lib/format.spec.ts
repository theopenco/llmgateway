import { describe, expect, it } from "vitest";

import { perMillionToPerToken, perTokenToPerMillion } from "./format";

describe("price notation", () => {
	it("shows stored per-token prices as dollars per million", () => {
		expect(perTokenToPerMillion("0.3e-6")).toBe("0.3");
		expect(perTokenToPerMillion("2e-6")).toBe("2");
		expect(perTokenToPerMillion("0.000004")).toBe("4");
		// Binary floating point renders 0.055e-6 * 1e6 as 0.055000000000000007
		// without the precision round-trip, which would be a nonsense edit value.
		expect(perTokenToPerMillion("0.055e-6")).toBe("0.055");
	});

	it("stores what the carrier typed as the catalogue's own notation", () => {
		expect(perMillionToPerToken("0.3")).toBe("0.3e-6");
		expect(perMillionToPerToken(" 2 ")).toBe("2e-6");
		expect(perMillionToPerToken("0")).toBe("0");
	});

	it("round-trips without drift", () => {
		for (const price of ["0.15e-6", "0.47e-6", "2e-6", "1e-5", "0.055e-6"]) {
			expect(Number(perMillionToPerToken(perTokenToPerMillion(price)))).toBe(
				Number(price),
			);
		}
	});

	it("leaves non-numeric input for the server to reject", () => {
		expect(perTokenToPerMillion("abc")).toBe("");
		expect(perTokenToPerMillion(null)).toBe("");
		expect(perMillionToPerToken("abc")).toBe("abc");
	});
});
