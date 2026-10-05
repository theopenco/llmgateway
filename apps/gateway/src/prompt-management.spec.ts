import { beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { applyPromptReference } from "./lib/prompt-template.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

describe("prompt management", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl = "";

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	async function seedKeys() {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id",
				"org-id",
			),
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});
	}

	async function seedPrompt() {
		await db.insert(tables.prompt).values({
			id: "prompt-id",
			organizationId: "org-id",
			projectId: "project-id",
			name: "support-reply",
			productionVersion: 1,
			latestVersion: 2,
		});
		await db.insert(tables.promptVersion).values([
			{
				promptId: "prompt-id",
				version: 1,
				messages: [
					{ role: "system", content: "You support {{product}}." },
					{ role: "user", content: "Explain {{topic}} briefly." },
				],
				model: "llmgateway/custom",
				parameters: { temperature: 0.2 },
				variables: ["product", "topic"],
			},
			{
				promptId: "prompt-id",
				version: 2,
				messages: [{ role: "user", content: "Draft v2 about {{topic}}." }],
				model: "llmgateway/custom",
				variables: ["topic"],
			},
		]);
	}

	function chat(body: unknown, headers: Record<string, string> = {}) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				...headers,
			},
			body: JSON.stringify(body),
		});
	}

	test("expands the production prompt version with variables", async () => {
		await seedKeys();
		await seedPrompt();
		const res = await chat({
			prompt: {
				id: "support-reply",
				variables: { product: "LLM Gateway", topic: "fallbacks" },
			},
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-prompt-id")).toBe("prompt-id");
		expect(res.headers.get("x-llmgateway-prompt-version")).toBe("1");
		const json = await res.json();
		expect(json.choices[0].message.content).toMatch(
			/Explain fallbacks briefly/,
		);
		const logs = await waitForLogs(1);
		expect(JSON.stringify(logs[0].messages)).toContain(
			"You support LLM Gateway.",
		);
		expect(logs[0].temperature).toBe(0.2);
	});

	test("pins a version and appends caller messages", async () => {
		await seedKeys();
		await seedPrompt();
		const res = await chat({
			prompt: { id: "prompt-id", version: 2, variables: { topic: "caching" } },
			messages: [{ role: "user", content: "Then list three tips." }],
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-prompt-version")).toBe("2");
		const logs = await waitForLogs(1);
		const sent = JSON.stringify(logs[0].messages);
		expect(sent.indexOf("Draft v2 about caching.")).toBeLessThan(
			sent.indexOf("Then list three tips."),
		);
	});

	test("a caller's reasoning.effort overrides the prompt's reasoning_effort", async () => {
		await seedKeys();
		await seedPrompt();
		await db
			.update(tables.promptVersion)
			.set({ parameters: { temperature: 0.2, reasoning_effort: "high" } })
			.where(eq(tables.promptVersion.version, 1));
		const headers = new Headers({ Authorization: "Bearer real-token" });
		const withReasoning = await applyPromptReference(
			{
				prompt: {
					id: "support-reply",
					variables: { product: "p", topic: "t" },
				},
				reasoning: { effort: "low" },
			},
			headers,
		);
		expect(withReasoning.body).not.toHaveProperty("reasoning_effort");
		const plain = await applyPromptReference(
			{
				prompt: {
					id: "support-reply",
					variables: { product: "p", topic: "t" },
				},
			},
			headers,
		);
		expect((plain.body as Record<string, unknown>).reasoning_effort).toBe(
			"high",
		);
	});

	test("rejects missing variables, unknown prompts and bad keys", async () => {
		await seedKeys();
		await seedPrompt();
		const missing = await chat({ prompt: { id: "support-reply" } });
		expect(missing.status).toBe(400);
		expect(await missing.text()).toContain("Missing prompt variables");

		const unknown = await chat({ prompt: { id: "nope" } });
		expect(unknown.status).toBe(404);

		const badKey = await chat(
			{ prompt: { id: "support-reply" } },
			{ Authorization: "Bearer wrong-token" },
		);
		expect(badKey.status).toBe(401);
	});

	test("does not resolve another project's prompt", async () => {
		await seedKeys();
		await seedPrompt();
		await db.insert(tables.project).values({
			id: "other-project",
			name: "Other",
			organizationId: "org-id",
			mode: "api-keys",
		});
		await db
			.update(tables.prompt)
			.set({ projectId: "other-project" })
			.where(eq(tables.prompt.id, "prompt-id"));
		const res = await chat({
			prompt: { id: "prompt-id", variables: { product: "x", topic: "y" } },
		});
		expect(res.status).toBe(404);
	});
});
