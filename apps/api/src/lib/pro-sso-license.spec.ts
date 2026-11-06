import { afterEach, expect, it, vi } from "vitest";

import { hasScimAccess, hasSsoAccess } from "./sso-access.js";

const pro = {
	id: "pro-license-test-org",
	plan: "pro",
	proSeats: 3,
	proSsoEnabled: true,
	proScimEnabled: true,
};
afterEach(() => {
	vi.unstubAllEnvs();
});
it("does not treat a Pro add-on as a self-hosted deployment license", () => {
	vi.stubEnv("NODE_ENV", "production");
	vi.stubEnv("HOSTED", "false");
	expect(hasSsoAccess(pro)).toBe(false);
	expect(hasScimAccess(pro)).toBe(false);
});
it("admits paid add-ons on the hosted service without changing Enterprise gates", () => {
	vi.stubEnv("NODE_ENV", "production");
	vi.stubEnv("HOSTED", "true");
	expect(hasSsoAccess(pro)).toBe(true);
	expect(hasScimAccess(pro)).toBe(true);
	expect(hasSsoAccess({ ...pro, plan: "enterprise" })).toBe(false);
	expect(hasSsoAccess({ ...pro, proSeats: 101 })).toBe(false);
});
