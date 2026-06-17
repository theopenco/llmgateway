import { describe, expect, it } from "vitest";

import {
	assertSafeProviderBaseUrl,
	isPrivateOrReservedIp,
} from "./url-safety.js";

describe("isPrivateOrReservedIp", () => {
	it("flags loopback, private, link-local and reserved IPv4", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"192.168.1.1",
			"169.254.169.254",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
		]) {
			expect(isPrivateOrReservedIp(ip)).toBe(true);
		}
	});

	it("flags loopback, ULA and link-local IPv6", () => {
		for (const ip of ["::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
			expect(isPrivateOrReservedIp(ip)).toBe(true);
		}
	});

	it("allows public IPs", () => {
		expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
		expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
	});
});

describe("assertSafeProviderBaseUrl", () => {
	it("accepts public http(s) endpoints", () => {
		expect(() =>
			assertSafeProviderBaseUrl("https://api.openai.com"),
		).not.toThrow();
		expect(() =>
			assertSafeProviderBaseUrl("http://api.example.com:8080/v1"),
		).not.toThrow();
	});

	it("rejects loopback and reserved IP literals", () => {
		for (const url of [
			"http://127.0.0.1:7777",
			"http://169.254.169.254/latest/meta-data",
			"http://10.0.0.5",
			"http://192.168.1.1",
			"https://[::1]:443",
		]) {
			expect(() => assertSafeProviderBaseUrl(url)).toThrow();
		}
	});

	it("rejects internal hostnames", () => {
		for (const url of [
			"http://localhost:7777",
			"http://metadata.google.internal",
			"http://foo.internal",
			"http://service.local",
		]) {
			expect(() => assertSafeProviderBaseUrl(url)).toThrow();
		}
	});

	it("rejects non-http(s) schemes and malformed URLs", () => {
		expect(() => assertSafeProviderBaseUrl("file:///etc/passwd")).toThrow();
		expect(() => assertSafeProviderBaseUrl("gopher://127.0.0.1")).toThrow();
		expect(() => assertSafeProviderBaseUrl("not a url")).toThrow();
	});
});
