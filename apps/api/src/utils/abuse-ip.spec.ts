import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";

import {
	checkIpAbuse,
	describeAbuseReport,
	getAbuseIpCacheKey,
	getAbuseScoreThreshold,
	isAbuseCheckConfigured,
	isAbusiveReport,
} from "./abuse-ip.js";

const publicIp = "5.6.7.8";

const originalApiKey = process.env.ABUSE_IPDB_API_KEY;
const originalThreshold = process.env.ABUSE_IPDB_SCORE_THRESHOLD;

function abuseIpdbResponse(data: Record<string, unknown>): Response {
	return new Response(JSON.stringify({ data }), { status: 200 });
}

beforeEach(async () => {
	process.env.ABUSE_IPDB_API_KEY = "test-abuse-key";
	delete process.env.ABUSE_IPDB_SCORE_THRESHOLD;
	await redisClient.del(getAbuseIpCacheKey(publicIp));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await redisClient.del(getAbuseIpCacheKey(publicIp));
	if (originalApiKey === undefined) {
		delete process.env.ABUSE_IPDB_API_KEY;
	} else {
		process.env.ABUSE_IPDB_API_KEY = originalApiKey;
	}
	if (originalThreshold === undefined) {
		delete process.env.ABUSE_IPDB_SCORE_THRESHOLD;
	} else {
		process.env.ABUSE_IPDB_SCORE_THRESHOLD = originalThreshold;
	}
});

describe("configuration", () => {
	test("is disabled without an API key", () => {
		delete process.env.ABUSE_IPDB_API_KEY;
		expect(isAbuseCheckConfigured()).toBe(false);
	});

	test("defaults the threshold to 50 and honors a valid override", () => {
		expect(getAbuseScoreThreshold()).toBe(50);
		process.env.ABUSE_IPDB_SCORE_THRESHOLD = "80";
		expect(getAbuseScoreThreshold()).toBe(80);
		process.env.ABUSE_IPDB_SCORE_THRESHOLD = "not-a-number";
		expect(getAbuseScoreThreshold()).toBe(50);
	});
});

describe("isAbusiveReport", () => {
	test("only counts scores at or above the threshold", () => {
		expect(isAbusiveReport(null)).toBe(false);
		expect(
			isAbusiveReport({ ipAddress: publicIp, abuseConfidenceScore: 49 }),
		).toBe(false);
		expect(
			isAbusiveReport({ ipAddress: publicIp, abuseConfidenceScore: 50 }),
		).toBe(true);

		process.env.ABUSE_IPDB_SCORE_THRESHOLD = "90";
		expect(
			isAbusiveReport({ ipAddress: publicIp, abuseConfidenceScore: 50 }),
		).toBe(false);
	});
});

describe("checkIpAbuse", () => {
	test("skips the lookup without a key or for private and missing IPs", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		expect(await checkIpAbuse(null)).toBe(null);
		expect(await checkIpAbuse("unknown")).toBe(null);
		expect(await checkIpAbuse("192.168.1.10")).toBe(null);
		expect(await checkIpAbuse("127.0.0.1")).toBe(null);
		expect(await checkIpAbuse("::1")).toBe(null);

		delete process.env.ABUSE_IPDB_API_KEY;
		expect(await checkIpAbuse(publicIp)).toBe(null);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("returns the report and serves repeats from cache", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			abuseIpdbResponse({
				ipAddress: publicIp,
				abuseConfidenceScore: 100,
				totalReports: 12,
				countryCode: "NL",
				usageType: "Data Center/Web Hosting/Transit",
				isp: "Example Hosting",
				isTor: false,
			}),
		);

		const report = await checkIpAbuse(publicIp);
		expect(report).toMatchObject({
			ipAddress: publicIp,
			abuseConfidenceScore: 100,
			totalReports: 12,
			countryCode: "NL",
		});
		expect(isAbusiveReport(report)).toBe(true);

		const url = fetchSpy.mock.calls[0]?.[0] as URL;
		expect(url.origin + url.pathname).toBe(
			"https://api.abuseipdb.com/api/v2/check",
		);
		expect(url.searchParams.get("ipAddress")).toBe(publicIp);

		expect(await checkIpAbuse(publicIp)).toMatchObject({
			abuseConfidenceScore: 100,
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("never reports a whitelisted address as abusive", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			abuseIpdbResponse({
				ipAddress: publicIp,
				abuseConfidenceScore: 100,
				isWhitelisted: true,
			}),
		);

		expect(await checkIpAbuse(publicIp)).toBe(null);
	});

	test("fails open on lookup errors and error responses", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(new Error("timeout"));
		expect(await checkIpAbuse(publicIp)).toBe(null);

		fetchSpy.mockResolvedValue(new Response("rate limited", { status: 429 }));
		expect(await checkIpAbuse(publicIp)).toBe(null);
	});
});

describe("describeAbuseReport", () => {
	test("summarizes the fields an admin needs", () => {
		expect(
			describeAbuseReport({
				ipAddress: publicIp,
				abuseConfidenceScore: 100,
				totalReports: 12,
				usageType: "Data Center/Web Hosting/Transit",
				isTor: true,
			}),
		).toBe(
			"AbuseIPDB: confidence 100%, 12 reports, Data Center/Web Hosting/Transit, Tor exit node",
		);
	});
});
