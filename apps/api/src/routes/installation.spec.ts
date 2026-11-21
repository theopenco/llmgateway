import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
	type Mock,
} from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";

const INQUIRY_URL = "https://internal.llmgateway.io/public/contact/enterprise";

let token: string;
let fetchMock: Mock<typeof fetch>;
const realFetch = globalThis.fetch;

async function register(body: unknown, cookie: string | null = token) {
	return await app.request("/installation/register", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

describe("installation registration", () => {
	beforeEach(async () => {
		await deleteAll();
		await redisClient.flushdb();
		token = await createTestUser();
		vi.stubEnv("HOSTED", "false");
		vi.stubEnv("APP_VERSION", "v9.9.9");
		fetchMock = vi.fn<typeof fetch>(
			async () =>
				new Response(JSON.stringify({ success: true }), { status: 200 }),
		);
		globalThis.fetch = fetchMock;
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		vi.unstubAllEnvs();
	});

	test("forwards the inquiry as a self-hosted enterprise lead", async () => {
		const res = await register({
			email: "ops@example.com",
			name: "Ops Lead",
			size: "51-200",
			message: "We need SSO.",
		});

		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(INQUIRY_URL);
		expect(JSON.parse(String(init?.body))).toEqual({
			email: "ops@example.com",
			name: "Ops Lead",
			size: "51-200",
			deployment: "self_host",
			message:
				"Registered from a self-hosted installation (version v9.9.9).\n\nWe need SSO.",
		});
	});

	test("requires a signed-in user", async () => {
		const res = await register(
			{ email: "ops@example.com", size: "1-10" },
			null,
		);
		expect(res.status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("does not exist on the hosted service", async () => {
		vi.stubEnv("HOSTED", "true");
		const res = await register({ email: "ops@example.com", size: "1-10" });
		expect(res.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("rejects an invalid email without calling out", async () => {
		const res = await register({ email: "not-an-email", size: "1-10" });
		expect(res.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("limits registrations per user", async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			expect(
				(await register({ email: "ops@example.com", size: "1-10" })).status,
			).toBe(200);
		}
		const res = await register({ email: "ops@example.com", size: "1-10" });
		expect(res.status).toBe(429);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("reports a failed or rejected delivery", async () => {
		fetchMock.mockRejectedValueOnce(new Error("network down"));
		expect(
			(await register({ email: "ops@example.com", size: "1-10" })).status,
		).toBe(502);

		fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
		expect(
			(await register({ email: "ops@example.com", size: "1-10" })).status,
		).toBe(502);

		fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
		expect(
			(await register({ email: "ops@example.com", size: "1-10" })).status,
		).toBe(429);
	});
});
