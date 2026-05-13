import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	filteredModels,
	getTestOptions,
	hasOnlyModels,
	logMode,
	matchesTestModel,
	specifiedModels,
} from "@/chat-helpers.e2e.js";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";

import type { ProviderModelMapping } from "@llmgateway/models";

const AUDIO_PROJECT_ID = "audio-test-project-id";
const AUDIO_API_KEY_ID = "audio-test-api-key-id";
const AUDIO_API_KEY_TOKEN = "real-token-audio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO_PATH = path.join(
	__dirname,
	"test-fixtures",
	"test-audio.wav",
);

function readFixtureAudioBase64(): string {
	const bytes = fs.readFileSync(FIXTURE_AUDIO_PATH);
	return bytes.toString("base64");
}

const audioTestCases = filteredModels
	.filter((model) => {
		if (hasOnlyModels) {
			return model.providers.some(
				(provider: ProviderModelMapping) => provider.test === "only",
			);
		}
		return true;
	})
	.flatMap((model) => {
		const cases: { model: string; provider: ProviderModelMapping }[] = [];

		for (const provider of model.providers as ProviderModelMapping[]) {
			if (provider.inputAudioPrice === undefined) {
				continue;
			}
			if (provider.deactivatedAt && new Date() > provider.deactivatedAt) {
				continue;
			}
			if (provider.deprecatedAt && new Date() > provider.deprecatedAt) {
				continue;
			}

			if (specifiedModels) {
				if (!matchesTestModel(provider.providerId, model.id, provider.region)) {
					continue;
				}
			} else {
				if (provider.test === "skip") {
					continue;
				}
			}

			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			cases.push({
				model: `${provider.providerId}/${provider.region ? provider.modelName : model.id}`,
				provider,
			});
		}

		return cases;
	});

async function audioBeforeAllHook() {
	await beforeAllHook();
	await db
		.insert(tables.project)
		.values({
			id: AUDIO_PROJECT_ID,
			name: "Audio E2E Project",
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
			id: AUDIO_API_KEY_ID,
			token: AUDIO_API_KEY_TOKEN,
			projectId: AUDIO_PROJECT_ID,
			description: "Audio E2E API Key",
			createdBy: "user-id",
		})
		.onConflictDoNothing();
}

describe("e2e audio input", getTestOptions(), () => {
	beforeAll(audioBeforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(audioTestCases)(
		"/v1/chat/completions accepts input_audio for $model",
		{ ...getTestOptions(), timeout: 120_000 },
		async ({ model, provider }) => {
			const audioBase64 = readFixtureAudioBase64();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${AUDIO_API_KEY_TOKEN}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "What do you hear in this audio? Reply in one short sentence.",
								},
								{
									type: "input_audio",
									input_audio: { data: audioBase64, format: "wav" },
								},
							],
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					"audio chat.completions response",
					model,
					JSON.stringify(json).slice(0, 800),
				);
			}
			expect(res.status).toBe(200);
			expect(json.choices?.[0]?.message?.content).toBeTruthy();

			const audioTokens = json.usage?.prompt_tokens_details?.audio_tokens;
			expect(typeof audioTokens).toBe("number");
			expect(audioTokens).toBeGreaterThan(0);

			const audioInputCost = json.usage?.cost_details?.audio_input_cost;
			expect(typeof audioInputCost).toBe("number");

			const expected =
				audioTokens *
				Number(provider.inputAudioPrice ?? provider.inputPrice ?? "0");
			expect(audioInputCost).toBeCloseTo(expected, 8);
		},
	);
});
