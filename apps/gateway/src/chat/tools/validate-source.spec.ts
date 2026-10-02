import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { validateSource } from "@/chat/tools/validate-source.js";

describe("validateSource", () => {
	it("returns undefined when neither value is present", () => {
		expect(validateSource(undefined)).toBeUndefined();
		expect(validateSource(undefined, undefined)).toBeUndefined();
	});

	it("normalizes a valid explicit x-source", () => {
		expect(validateSource("https://www.example.com/app")).toBe(
			"example.com/app",
		);
		expect(validateSource("my-app")).toBe("my-app");
	});

	it("throws 400 on an invalid explicit x-source", () => {
		try {
			validateSource("http://localhost:3000/page?x=1");
			expect.unreachable("expected HTTPException");
		} catch (e) {
			expect(e).toBeInstanceOf(HTTPException);
			expect((e as HTTPException).status).toBe(400);
		}
		expect(() => validateSource("my_app")).toThrow(HTTPException);
	});

	it("throws on an invalid x-source even when a valid referer exists", () => {
		expect(() => validateSource("bad value", "https://example.com")).toThrow(
			HTTPException,
		);
	});

	it("treats an empty x-source as absent instead of throwing", () => {
		expect(validateSource("")).toBeUndefined();
		expect(validateSource("", "https://www.example.com/page")).toBe(
			"example.com/page",
		);
	});

	it("uses a valid referer when x-source is absent", () => {
		expect(validateSource(undefined, "https://www.example.com/page")).toBe(
			"example.com/page",
		);
	});

	it("drops an invalid referer instead of throwing", () => {
		expect(
			validateSource(undefined, "http://localhost:3000/page?x=1"),
		).toBeUndefined();
		expect(
			validateSource(undefined, "https://example.com/a_b"),
		).toBeUndefined();
	});
});
