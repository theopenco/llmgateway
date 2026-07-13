import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
} from "@/chat-helpers.e2e.js";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";

const OCR_PROJECT_ID = "ocr-test-project-id";
const OCR_API_KEY_ID = "ocr-test-api-key-id";
const OCR_API_KEY_TOKEN = "real-token-ocr";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE_PATH = path.join(
	__dirname,
	"test-fixtures",
	"test-image.png",
);

function readFixtureImageDataUrl(): string {
	const bytes = fs.readFileSync(FIXTURE_IMAGE_PATH);
	return `data:image/png;base64,${bytes.toString("base64")}`;
}

// OCR resolves a real provider key from env vars (credits mode), so skip when
// the Mistral key isn't configured rather than failing with an auth error.
const hasMistralKey = Boolean(process.env.LLM_MISTRAL_API_KEY);

async function ocrBeforeAllHook() {
	await beforeAllHook();
	// Credits mode so the gateway resolves the Mistral key from env vars.
	await db
		.insert(tables.project)
		.values({
			id: OCR_PROJECT_ID,
			name: "OCR E2E Project",
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
			id: OCR_API_KEY_ID,
			token: OCR_API_KEY_TOKEN,
			projectId: OCR_PROJECT_ID,
			description: "OCR E2E API Key",
			createdBy: "user-id",
		})
		.onConflictDoNothing();
}

describe("e2e ocr", getConcurrentTestOptions(), () => {
	beforeAll(ocrBeforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.skipIf(!hasMistralKey)(
		"/v1/ocr extracts a document via mistral-ocr-latest",
		{ ...getTestOptions(), timeout: 120_000 },
		async () => {
			const res = await app.request("/v1/ocr", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${OCR_API_KEY_TOKEN}`,
				},
				body: JSON.stringify({
					model: "mistral-ocr-latest",
					document: {
						type: "image_url",
						image_url: readFixtureImageDataUrl(),
					},
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("ocr response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(Array.isArray(json.pages)).toBe(true);
			expect(json.pages.length).toBeGreaterThanOrEqual(1);
			expect(json.pages[0]).toHaveProperty("markdown");
			expect(json).toHaveProperty("usage_info");
			expect(typeof json.usage_info.pages_processed).toBe("number");
			expect(json.usage_info.pages_processed).toBeGreaterThanOrEqual(1);
		},
	);

	test.skipIf(!hasMistralKey)(
		"/v1/ocr rejects an unknown model with 400",
		getTestOptions(),
		async () => {
			const res = await app.request("/v1/ocr", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${OCR_API_KEY_TOKEN}`,
				},
				body: JSON.stringify({
					model: "not-a-real-ocr-model",
					document: {
						type: "image_url",
						image_url: readFixtureImageDataUrl(),
					},
				}),
			});

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error.code).toBe("model_not_found");
		},
	);
});
