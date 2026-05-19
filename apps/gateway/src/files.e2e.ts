import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	getTestOptions,
	logMode,
	matchesTestModel,
	specifiedModels,
} from "@/chat-helpers.e2e.js";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";

const FILES_PROJECT_ID = "files-test-project-id";
const FILES_API_KEY_ID = "files-test-api-key-id";
const FILES_API_KEY_TOKEN = "real-token-files";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF_PATH = path.join(
	__dirname,
	"test-fixtures",
	"test-document.pdf",
);

const CANARY = "LLMGATEWAY-PDF-CANARY-7421";

function readFixturePdfDataUrl(): string {
	const bytes = fs.readFileSync(FIXTURE_PDF_PATH);
	return `data:application/pdf;base64,${bytes.toString("base64")}`;
}

// PDF-capable model targets. Each entry is the `provider/model` string the
// gateway accepts as the `model` field. Restricted to models known to support
// PDF input natively (Anthropic Claude 3+, Gemini 1.5+, OpenAI gpt-4.1/4o+
// chat completions).
const pdfModels: { model: string }[] = [
	{ model: "anthropic/claude-sonnet-4-5" },
	{ model: "google-ai-studio/gemini-3.5-flash" },
	{ model: "openai/gpt-4.1-mini" },
];

const filteredPdfModels = pdfModels.filter(({ model }) => {
	if (!specifiedModels) {
		return true;
	}
	const [providerId, ...rest] = model.split("/");
	const modelId = rest.join("/");
	return matchesTestModel(providerId, modelId);
});

async function filesBeforeAllHook() {
	await beforeAllHook();
	await db
		.insert(tables.project)
		.values({
			id: FILES_PROJECT_ID,
			name: "Files E2E Project",
			organizationId: "org-id",
			mode: "credits",
		})
		.onConflictDoUpdate({
			target: tables.project.id,
			set: { mode: "credits", organizationId: "org-id" },
		});
	await db
		.insert(tables.apiKey)
		.values({
			id: FILES_API_KEY_ID,
			token: FILES_API_KEY_TOKEN,
			projectId: FILES_PROJECT_ID,
			description: "Files E2E API Key",
			createdBy: "user-id",
		})
		.onConflictDoNothing();
}

describe("e2e pdf file input", getTestOptions(), () => {
	beforeAll(filesBeforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(filteredPdfModels)(
		"/v1/chat/completions reads a PDF for $model",
		{ ...getTestOptions(), timeout: 120_000 },
		async ({ model }) => {
			const pdfDataUrl = readFixturePdfDataUrl();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${FILES_API_KEY_TOKEN}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "Read the attached PDF and respond with the exact canary string written in it. Do not include any other text.",
								},
								{
									type: "file",
									file: {
										file_data: pdfDataUrl,
										filename: "test-document.pdf",
									},
								},
							],
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					"pdf chat.completions response",
					model,
					JSON.stringify(json).slice(0, 800),
				);
			}
			expect(res.status).toBe(200);
			const content = json.choices?.[0]?.message?.content;
			expect(typeof content).toBe("string");
			expect(content).toContain(CANARY);
		},
	);
});
