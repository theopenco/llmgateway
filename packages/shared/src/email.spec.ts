import { createServer } from "node:http";

import { expect, test, vi, afterAll, beforeAll } from "vitest";

import type { Server } from "node:http";

let upstream: Server | undefined;

beforeAll(async () => {
	upstream = createServer((_request, response) => {
		response.on("close", () => {
			disconnected = true;
		});
		if (responseStage === "body") {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write('{"id":');
		}
	});
	await new Promise<void>((resolve) =>
		upstream!.listen(0, "127.0.0.1", resolve),
	);
	const address = upstream.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing upstream address");
	}
	const fetch = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) =>
		fetch(`http://127.0.0.1:${address.port}/contacts`, options),
	);
});

afterAll(async () => {
	if (upstream) {
		upstream.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			upstream!.close((error) => (error ? reject(error) : resolve())),
		);
	}
	vi.restoreAllMocks();
});

test.each(["headers", "body"])(
	"aborts a Resend request stalled at %s",
	async (stage) => {
		responseStage = stage;
		disconnected = false;
		const { createResendClient } = await import("@llmgateway/shared/email");
		const resend = createResendClient("test-key", 1000);
		const result = await resend.contacts.create({
			email: "reader@example.com",
			unsubscribed: false,
		});
		expect(result.error).not.toBeNull();
		await vi.waitFor(() => expect(disconnected).toBe(true));
	},
);
let responseStage = "headers";
let disconnected = false;
