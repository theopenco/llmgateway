import assert from "node:assert/strict";
import { test } from "node:test";

import {
	includeRoutingLatency,
	parseSainaConfig,
	sainaBody,
	sainaEndpoint,
	sainaFailure,
	selectSaina,
	verifySaina,
} from "./saina-routing.js";

const fixed = ["candidate-a", "candidate-b"];
const config = parseSainaConfig(
	{
		model: "router",
		revision: "a".repeat(40),
		classifierReserveUsd: "1",
		candidates: fixed.map((model, i) => ({
			model,
			description: `Capability ${i}`,
			estimatedRequestCostUsd: String(i + 1),
		})),
	},
	fixed,
);
const request = { messages: [{ role: "user" as const, content: "A request" }] };
const reply =
	(body: unknown, status = 200): typeof fetch =>
	async () =>
		new Response(JSON.stringify(body), { status });

void test("passes request, anonymous capabilities and prices, without model identifiers", () => {
	const body = sainaBody(config, request);
	assert.equal(body.state, "A request");
	assert.deepEqual(Object.keys(body.questions.route.options), [
		"option_0",
		"option_1",
	]);
	assert.ok(!JSON.stringify(body).includes("candidate-a"));
	assert.match(body.questions.route.options.option_0, /USD 1/);
	assert.equal(
		sainaBody(config, {
			messages: [{ role: "system", content: "Rules" }, ...request.messages],
		}).state,
		"system: Rules\n\nuser: A request",
	);
});

void test("rejects duplicate candidates, missing prices and unpinned weights", () => {
	assert.throws(() => parseSainaConfig({ ...config, revision: "main" }, fixed));
	assert.throws(() =>
		parseSainaConfig({ ...config, classifierReserveUsd: "0" }, fixed),
	);
	assert.throws(() =>
		parseSainaConfig(
			{ ...config, candidates: [config.candidates[0], config.candidates[0]] },
			fixed,
		),
	);
	assert.throws(() =>
		parseSainaConfig(
			{
				...config,
				candidates: [
					{ ...config.candidates[0], estimatedRequestCostUsd: "NaN" },
					config.candidates[1],
				],
			},
			fixed,
		),
	);
	assert.deepEqual(
		parseSainaConfig({ ...config, privateSetting: "discard" }, fixed),
		config,
	);
});

void test("allows HTTPS and loopback origins only", () => {
	assert.equal(
		sainaEndpoint("http://127.0.0.1:8000", "/v1/ask"),
		"http://127.0.0.1:8000/v1/ask",
	);
	assert.throws(() => sainaEndpoint("http://example.com", "/v1/ask"));
	assert.throws(() => sainaEndpoint("https://example.com/path", "/v1/ask"));
});

void test("verifies hosted and standalone revisions", async () => {
	await verifySaina(
		config,
		"https://example.com",
		"test-token",
		reply({ data: [{ id: "router", revision: config.revision }] }),
	);
	await assert.rejects(
		verifySaina(
			config,
			"https://example.com",
			"test-token",
			reply({ data: [{ id: "router", revision: "b".repeat(40) }] }),
		),
	);
	let calls = 0;
	await verifySaina(
		config,
		"http://localhost:8000",
		"test-token",
		async () =>
			new Response(
				JSON.stringify(
					++calls === 1
						? { data: [{ id: "router" }] }
						: { model: "router", revision: config.revision },
				),
			),
	);
});

void test("uses argmax and never an answer label to execute a model", async () => {
	const result = await selectSaina(
		config,
		request,
		"case",
		"https://example.com",
		"test-token",
		1000,
		reply({
			model: "router",
			answers: {
				route: {
					selection: "arbitrary",
					probabilities: { option_0: 0.2, option_1: 0.8 },
				},
			},
		}),
	);
	assert.equal(result.selectedModel, "candidate-b");
	assert.equal(result.error, null);
});

void test("invalid output and HTTP errors remain failed routing trials", async () => {
	for (const body of [
		{ model: "other" },
		{
			model: "router",
			answers: { route: { probabilities: { option_0: 0.2, option_1: 0.3 } } },
		},
		{ model: "router", answers: { route: { probabilities: { unknown: 1 } } } },
	]) {
		const result = await selectSaina(
			config,
			request,
			"case",
			"https://example.com",
			"test-token",
			1000,
			reply(body),
		);
		assert.equal(result.selectedModel, null);
		assert.ok(sainaFailure(result).error);
	}
	const failed = await selectSaina(
		config,
		request,
		"case",
		"https://example.com",
		"test-token",
		1000,
		reply({}, 503),
	);
	assert.equal(failed.error, "saina_http_error");
});

void test("network errors do not leak transport details", async () => {
	const result = await selectSaina(
		config,
		request,
		"case",
		"https://example.com",
		"test-token",
		1000,
		async () => {
			throw new Error("private transport details");
		},
	);
	assert.equal(result.error, "saina_request_error");
	assert.ok(!JSON.stringify(result).includes("private transport"));
});

void test("adds classifier wall time to total and first-content latency", () => {
	const decision = {
		caseId: "case",
		model: "router",
		revision: config.revision,
		selectedModel: null,
		latencyMs: 25,
		requestId: null,
		error: "saina_request_error",
	};
	const response = sainaFailure(decision);
	response.timing.totalMs = 100;
	response.timing.firstContentMs = 40;
	response.timing.generationMs = 60;
	response.streamChunks = [{ atMs: 40, characters: 4, kind: "content" }];
	const timed = includeRoutingLatency(response, decision);
	assert.equal(timed.timing.totalMs, 125);
	assert.equal(timed.timing.firstContentMs, 65);
	assert.equal(timed.timing.generationMs, 60);
	assert.equal(timed.streamChunks[0].atMs, 65);
});
