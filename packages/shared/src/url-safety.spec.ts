import { afterEach, describe, expect, it } from "vitest";

import {
	assertSafeContentUrl,
	assertSafeProviderBaseUrl,
	assertSafeUserUrl,
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

	it("flags IPv6 transition addresses embedding internal IPv4 targets", () => {
		expect(isPrivateOrReservedIp("64:ff9b::a9fe:a9fe")).toBe(true); // NAT64 → 169.254.169.254
		expect(isPrivateOrReservedIp("64:ff9b::169.254.169.254")).toBe(true); // NAT64 dotted form
		expect(isPrivateOrReservedIp("64:ff9b::7f00:1")).toBe(true); // NAT64 → 127.0.0.1
		expect(isPrivateOrReservedIp("64:ff9b::808:808")).toBe(false); // NAT64 → 8.8.8.8 (public)
		expect(isPrivateOrReservedIp("64:ff9b:1::1")).toBe(true); // NAT64 local-use /48
		expect(isPrivateOrReservedIp("2002:a9fe:a9fe::1")).toBe(true); // 6to4 → 169.254.169.254
		expect(isPrivateOrReservedIp("2002:7f00:1::1")).toBe(true); // 6to4 → 127.0.0.1
		expect(isPrivateOrReservedIp("2001::1")).toBe(true); // Teredo 2001::/32
		expect(isPrivateOrReservedIp("2001:0:5ef5:79fb::1")).toBe(true); // Teredo
	});

	it("flags multicast, discard, documentation and non-canonical IPv6 forms", () => {
		expect(isPrivateOrReservedIp("ff02::1")).toBe(true); // multicast
		expect(isPrivateOrReservedIp("100::1")).toBe(true); // discard-only 100::/64
		expect(isPrivateOrReservedIp("2001:db8::1")).toBe(true); // documentation
		expect(isPrivateOrReservedIp("3fff::1")).toBe(true); // documentation 3fff::/20
		expect(isPrivateOrReservedIp("0:0:0:0:0:0:0:1")).toBe(true); // uncompressed ::1
		expect(isPrivateOrReservedIp("::7f00:1")).toBe(true); // IPv4-compatible → 127.0.0.1
		expect(isPrivateOrReservedIp("fe80::1%eth0")).toBe(true); // zone index
		expect(isPrivateOrReservedIp("beef::cafe::1")).toBe(true); // malformed → fail closed
	});

	it("allows public IPv6", () => {
		expect(isPrivateOrReservedIp("2606:4700::6810:84e5")).toBe(false);
		expect(isPrivateOrReservedIp("2a00:1450:4001:829::200e")).toBe(false);
		expect(isPrivateOrReservedIp("2600:1f18:222:e900::1")).toBe(false);
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

describe("assertSafeContentUrl", () => {
	it("accepts public https media URLs", () => {
		expect(() =>
			assertSafeContentUrl("https://cdn.example.com/image.png"),
		).not.toThrow();
		expect(() =>
			assertSafeContentUrl("https://example.com:8443/video.mp4"),
		).not.toThrow();
	});

	it("rejects http URLs (even public)", () => {
		expect(() =>
			assertSafeContentUrl("http://cdn.example.com/image.png"),
		).toThrow("Content URL must use https");
	});

	it("rejects loopback and reserved IP literals", () => {
		for (const url of [
			"http://127.0.0.1/x.png",
			"https://169.254.169.254/latest/meta-data",
			"http://10.0.0.5/a.jpg",
			"http://192.168.1.1/a.jpg",
			"https://[::1]/a.jpg",
		]) {
			expect(() => assertSafeContentUrl(url)).toThrow();
		}
	});

	it("rejects internal hostnames", () => {
		for (const url of [
			"http://localhost/a.png",
			"http://metadata.google.internal/x",
			"https://foo.internal/x.png",
			"https://service.local/x.png",
		]) {
			expect(() => assertSafeContentUrl(url)).toThrow();
		}
	});

	it("rejects non-https schemes and malformed URLs", () => {
		expect(() => assertSafeContentUrl("file:///etc/passwd")).toThrow();
		expect(() => assertSafeContentUrl("gopher://127.0.0.1")).toThrow();
		expect(() => assertSafeContentUrl("not a url")).toThrow(
			"Invalid content URL",
		);
	});
});

describe("assertSafeUserUrl", () => {
	it("accepts only public https targets", () => {
		expect(() =>
			assertSafeUserUrl("https://mcp.example.com/rpc"),
		).not.toThrow();
		expect(() => assertSafeUserUrl("http://mcp.example.com/rpc")).toThrow(
			"must use https",
		);
		expect(() => assertSafeUserUrl("https://127.0.0.1/rpc")).toThrow(
			"private or reserved",
		);
		expect(() => assertSafeUserUrl("https://service.internal/rpc")).toThrow(
			"disallowed internal host",
		);
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
