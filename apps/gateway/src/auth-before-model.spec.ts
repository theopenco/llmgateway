import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

function transcriptionForm(): FormData {
	const form = new FormData();
	form.append("model", "not-a-real-model");
	form.append(
		"file",
		new File([Buffer.from("MOCK_AUDIO_BYTES")], "audio.mp3", {
			type: "audio/mpeg",
		}),
	);
	return form;
}

const endpoints: {
	path: string;
	body: () => BodyInit;
	contentType?: string;
}[] = [
	{
		path: "/v1/embeddings",
		contentType: "application/json",
		body: () => JSON.stringify({ model: "not-a-real-model", input: "test" }),
	},
	{
		path: "/v1/ocr",
		contentType: "application/json",
		body: () =>
			JSON.stringify({
				model: "not-a-real-model",
				document: {
					type: "document_url",
					document_url: "https://example.com/doc.pdf",
				},
			}),
	},
	{
		path: "/v1/audio/speech",
		contentType: "application/json",
		body: () => JSON.stringify({ model: "not-a-real-model", input: "test" }),
	},
	{
		path: "/v1/audio/transcriptions",
		body: transcriptionForm,
	},
];

describe("authentication runs before model resolution", () => {
	createGatewayApiTestHarness();

	for (const endpoint of endpoints) {
		test(`${endpoint.path} rejects a missing API key with 401`, async () => {
			const res = await app.request(endpoint.path, {
				method: "POST",
				headers: endpoint.contentType
					? { "Content-Type": endpoint.contentType }
					: {},
				body: endpoint.body(),
			});

			expect(res.status).toBe(401);
		});

		test(`${endpoint.path} rejects an unknown API key with 401`, async () => {
			const res = await app.request(endpoint.path, {
				method: "POST",
				headers: {
					...(endpoint.contentType
						? { "Content-Type": endpoint.contentType }
						: {}),
					Authorization: "Bearer not-a-real-token",
				},
				body: endpoint.body(),
			});

			expect(res.status).toBe(401);
		});
	}
});
