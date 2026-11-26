import { describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile }));
vi.mock("@/lib/icons/Logo", () => ({
	default: () => null,
	LogoLockup: () => null,
}));

describe("home-og", () => {
	it("does not read files at import", async () => {
		await import("./home-og");
		expect(readFile).not.toHaveBeenCalled();
	});
});
