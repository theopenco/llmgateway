import { deflateSync } from "node:zlib";

import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	decisionModels,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return c >>> 0;
});

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** A solid RGB PNG; Jev rejects images under 280 pixels per side. */
function solidPngDataUrl(size: number, rgb: [number, number, number]): string {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // truecolor
	const row = Buffer.concat([
		Buffer.from([0]),
		Buffer.alloc(size * 3, Buffer.from(rgb)),
	]);
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
	return `data:image/png;base64,${png.toString("base64")}`;
}

const RED_PNG_DATA_URL = solidPngDataUrl(400, [220, 20, 20]);

describe("e2e decisions", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(decisionModels)(
		"decisions $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/decisions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					input:
						"Our production checkout has returned 500 errors for every customer since 09:00.",
					questions: [
						{
							type: "predicate",
							name: "is_outage",
							instructions: "Does this describe a production outage?",
						},
						{
							type: "choice",
							name: "team",
							instructions: "Which team should handle this?",
							choices: [
								{ value: "billing", description: "Charges and refunds" },
								{ value: "engineering", description: "Bugs and outages" },
							],
						},
						{
							type: "score",
							name: "severity",
							instructions: "How severe is this issue?",
							levels: [
								{ label: "Cosmetic" },
								{ label: "Minor" },
								{ label: "Critical" },
							],
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("decisions response:", JSON.stringify(json, null, 2));
			}

			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(Array.isArray(json.answers)).toBe(true);
			expect(json.answers).toHaveLength(3);

			const [outage, team, severity] = json.answers;
			// A model may decline a single question; every other answer must
			// still be well-formed.
			if (outage.type !== "refusal") {
				expect(outage).toMatchObject({ type: "predicate", name: "is_outage" });
				expect(outage.probability).toBeGreaterThanOrEqual(0);
				expect(outage.probability).toBeLessThanOrEqual(1);
			}
			if (team.type !== "refusal") {
				expect(team).toMatchObject({ type: "choice", name: "team" });
				expect(["billing", "engineering"]).toContain(team.choice);
				expect(team.probabilities).toHaveLength(2);
			}
			if (severity.type !== "refusal") {
				expect(severity).toMatchObject({ type: "score", name: "severity" });
				expect(severity.score).toBeGreaterThanOrEqual(0);
				expect(severity.score).toBeLessThanOrEqual(2);
				expect(severity.probabilities).toHaveLength(3);
			}

			expect(json.usage.input_tokens).toBeGreaterThan(0);

			const log = await validateLogByRequestId(requestId);
			expect(log.apiOrigin).toBe("decisions");
			expect(Number(log.cost)).toBeGreaterThan(0);
		},
	);

	test.each(decisionModels.filter(({ provider }) => provider.vision))(
		"decisions image $model",
		getTestOptions(),
		async ({ model }) => {
			const res = await app.request("/v1/decisions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					input: [
						{
							role: "user",
							content: [{ type: "input_image", image_url: RED_PNG_DATA_URL }],
						},
					],
					questions: [
						{
							type: "predicate",
							name: "is_red",
							instructions: "Is the image a solid red square?",
						},
					],
				}),
			});

			const json = await res.json();
			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(json.answers[0].probability).toBeGreaterThan(0.5);
		},
	);

	// OpenRouter's System One shape: image parts inline in `state`, which
	// TypeSafe only reads once the gateway moves them into `assets`.
	test.each(
		decisionModels.filter(
			({ provider }) => provider.vision && provider.providerId === "typesafe",
		),
	)("systemone inline image $model", getTestOptions(), async ({ model }) => {
		const res = await app.request("/v1/systemone", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-no-fallback": "true",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model,
				state: [
					"Photo:",
					{ type: "image_url", image_url: { url: RED_PNG_DATA_URL } },
				],
				questions: {
					is_red: {
						type: "noul",
						instructions: "Is the photo a solid red square?",
					},
				},
			}),
		});

		const json = await res.json();
		expect(res.status, JSON.stringify(json)).toBe(200);
		expect(json.answers.is_red.noul).toBeGreaterThan(0.5);
		// A 400x400 image costs a few hundred tokens; as base64 text it would
		// cost thousands.
		expect(json.usage.input_tokens).toBeLessThan(1500);
	});
});
