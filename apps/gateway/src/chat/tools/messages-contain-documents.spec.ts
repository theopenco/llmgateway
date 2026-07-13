import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import { messagesContainDocuments } from "./messages-contain-documents.js";

import type { BaseMessage, ProviderModelMapping } from "@llmgateway/models";

describe("messagesContainDocuments", () => {
	it("returns false for plain text-only messages", () => {
		const msgs: BaseMessage[] = [{ role: "user", content: "hello" }];
		expect(messagesContainDocuments(msgs)).toBe(false);
	});

	it("returns false for image/audio-only multipart content", () => {
		const msgs: BaseMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "describe this" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,A" } },
					{
						type: "input_audio",
						input_audio: { data: "AAAA", format: "wav" },
					},
				],
			},
		];
		expect(messagesContainDocuments(msgs)).toBe(false);
	});

	it("returns true when any part is a file block", () => {
		const msgs: BaseMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "summarize" },
					{
						type: "file",
						file: {
							filename: "doc.pdf",
							file_data: "data:application/pdf;base64,AAAA",
						},
					},
				],
			},
		];
		expect(messagesContainDocuments(msgs)).toBe(true);
	});
});

describe("Gemini document capability flag", () => {
	const expectedDocumentModelIds = [
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
	];

	for (const id of expectedDocumentModelIds) {
		it(`marks google-ai-studio variant of ${id} as document: true`, () => {
			const model = models.find((m) => m.id === id);
			expect(model, `Expected model ${id} to exist`).toBeDefined();
			const providers = model!.providers as readonly ProviderModelMapping[];
			const aiStudio = providers.find(
				(p) => p.providerId === "google-ai-studio",
			);
			expect(aiStudio).toBeDefined();
			expect(aiStudio?.document).toBe(true);
		});
	}
});
