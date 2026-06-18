import { afterEach, describe, expect, it } from "vitest";

import {
	assertSafeProviderBaseUrl,
	isPrivateOrReservedIp,
	isProviderUrlGuardEnabled,
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

	it("flags IPv4-mapped IPv6 in hex form (DNS rebinding shape)", () => {
		expect(isPrivateOrReservedIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
		expect(isPrivateOrReservedIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
		expect(isPrivateOrReservedIp("::ffff:0a00:0001")).toBe(true); // 10.0.0.1
		expect(isPrivateOrReservedIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8
	});

	it("flags IANA special-use IPv4 ranges", () => {
		for (const ip of [
			"192.0.0.1", // 192.0.0.0/24
			"192.0.2.5", // TEST-NET-1
			"192.88.99.1", // 6to4 relay anycast
			"198.18.0.1", // benchmarking 198.18.0.0/15
			"198.19.255.1", // benchmarking
			"198.51.100.7", // TEST-NET-2
			"203.0.113.7", // TEST-NET-3
			"240.0.0.1", // reserved/future
		]) {
			expect(isPrivateOrReservedIp(ip)).toBe(true);
		}
	});

	it("allows public IPs", () => {
		expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
		expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
		expect(isPrivateOrReservedIp("198.16.0.1")).toBe(false); // just below 198.18/15
		expect(isPrivateOrReservedIp("198.20.0.1")).toBe(false); // just above 198.18/15
	});
});

describe("assertSafeProviderBaseUrl", () => {
	it("accepts public https endpoints", () => {
		expect(() =>
			assertSafeProviderBaseUrl("https://api.openai.com"),
		).not.toThrow();
		expect(() =>
			assertSafeProviderBaseUrl("https://api.example.com:8080/v1"),
		).not.toThrow();
	});

	it("rejects http endpoints (even public)", () => {
		expect(() =>
			assertSafeProviderBaseUrl("http://api.example.com:8080/v1"),
		).toThrow();
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

	it("rejects non-https schemes and malformed URLs", () => {
		expect(() => assertSafeProviderBaseUrl("file:///etc/passwd")).toThrow();
		expect(() => assertSafeProviderBaseUrl("gopher://127.0.0.1")).toThrow();
		expect(() => assertSafeProviderBaseUrl("not a url")).toThrow();
	});
});

describe("isProviderUrlGuardEnabled", () => {
	const originalFlag = process.env.ALLOW_INSECURE_PROVIDER_URLS;

	afterEach(() => {
		if (originalFlag === undefined) {
			delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		} else {
			process.env.ALLOW_INSECURE_PROVIDER_URLS = originalFlag;
		}
	});

	it("is enabled by default and when the flag is not exactly 'true'", () => {
		delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		expect(isProviderUrlGuardEnabled()).toBe(true);
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "false";
		expect(isProviderUrlGuardEnabled()).toBe(true);
	});

	it("is disabled only when explicitly opted out", () => {
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
		expect(isProviderUrlGuardEnabled()).toBe(false);
	});
});
