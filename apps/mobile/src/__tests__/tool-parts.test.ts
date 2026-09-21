import { client } from "@/api/client";
import {
	answerToolCall,
	readToolParts,
	uncertainToolOutcome,
} from "@/api/tool-parts";

import type { ToolPart } from "@/api/tool-parts";

jest.mock("@/api/client", () => ({ client: { POST: jest.fn() } }));
const part: ToolPart = {
	type: "dynamic-tool",
	toolName: "gmail__search_messages",
	toolCallId: "call",
	state: "approval-requested",
	input: { query: "demo" },
	approval: { id: "approval", signature: "fixture-signature" },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
	jest.resetAllMocks();
	jest.mocked(client.POST).mockResolvedValue({
		data: { result: '{"messages":[{"id":"demo"}]}' },
		response: new Response(),
	});
});

test("records uncertainty before execution, then saves the signed result", async () => {
	const saved: ToolPart[][] = [];
	const persist = jest.fn(async (parts: ToolPart[]) => {
		saved.push(parts);
	});
	jest.mocked(client.POST).mockImplementation(async () => {
		expect(saved[0][0]).toMatchObject({
			state: "output-error",
			errorText: uncertainToolOutcome,
			approval: { approved: true },
		});
		return {
			data: { result: '{"messages":[{"id":"demo"}]}' },
			response: new Response(),
		};
	});
	const untouched = { ...part, toolCallId: "other" };
	const result = await answerToolCall({
		parts: [part, untouched],
		toolCallId: "call",
		approved: true,
		signal: signal(),
		persist,
	});
	expect(result[0]).toMatchObject({
		state: "output-available",
		output: { messages: [{ id: "demo" }] },
		approval: { ...part.approval, approved: true },
	});
	expect(result[1]).toEqual(untouched);
	expect(saved).toHaveLength(2);
	expect(client.POST).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledWith(
		"/connectors/{connectorId}/tools/{toolName}",
		expect.objectContaining({
			params: { path: { connectorId: "gmail", toolName: "search_messages" } },
			body: { input: { query: "demo" } },
		}),
	);
});

test("declining saves a denial and never contacts the connector", async () => {
	const persist = jest.fn(async () => {});
	const result = await answerToolCall({
		parts: [part],
		toolCallId: "call",
		approved: false,
		signal: signal(),
		persist,
	});
	expect(result[0]).toMatchObject({
		state: "output-denied",
		approval: { approved: false },
	});
	expect(persist).toHaveBeenCalledWith(result);
	expect(client.POST).not.toHaveBeenCalled();
});

test("does not execute if the pre-execution save fails", async () => {
	await expect(
		answerToolCall({
			parts: [part],
			toolCallId: "call",
			approved: true,
			signal: signal(),
			persist: async () => {
				throw new Error("Save failed");
			},
		}),
	).rejects.toThrow("Save failed");
	expect(client.POST).not.toHaveBeenCalled();
});

test("a lost connector response leaves an uncertain outcome and is not retried", async () => {
	jest.mocked(client.POST).mockRejectedValue(new Error("Connection lost"));
	const persist = jest.fn(async () => {});
	await expect(
		answerToolCall({
			parts: [part],
			toolCallId: "call",
			approved: true,
			signal: signal(),
			persist,
		}),
	).rejects.toThrow(uncertainToolOutcome);
	expect(persist).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledTimes(1);
});

test("does not execute when stopped while saving", async () => {
	const controller = new AbortController();
	await expect(
		answerToolCall({
			parts: [part],
			toolCallId: "call",
			approved: true,
			signal: controller.signal,
			persist: async () => {
				controller.abort();
			},
		}),
	).rejects.toThrow();
	expect(client.POST).not.toHaveBeenCalled();
});

test.each(["output-error", "output-available", "output-denied"] as const)(
	"cannot execute an already answered %s request",
	async (state) => {
		await expect(
			answerToolCall({
				parts: [{ ...part, state }],
				toolCallId: "call",
				approved: true,
				signal: signal(),
				persist: async () => {},
			}),
		).rejects.toThrow("already been answered");
		expect(client.POST).not.toHaveBeenCalled();
	},
);

test("restores pending signatures and converts interrupted web execution into an uncertain result", () => {
	expect(readToolParts(JSON.stringify([part]))).toEqual([part]);
	const restored = readToolParts(
		JSON.stringify([
			{
				...part,
				state: "approval-responded",
				approval: { ...part.approval, approved: true },
			},
		]),
	);
	expect(restored[0]).toMatchObject({
		state: "output-error",
		errorText: uncertainToolOutcome,
		approval: { approved: true },
	});
	expect(
		readToolParts(
			JSON.stringify([
				{ ...part, type: "tool-gmail__search_messages", toolName: undefined },
			]),
		)[0].toolName,
	).toBe(part.toolName);
});

test("invalid stored tool data produces an actionable error", () => {
	expect(() => readToolParts('{"broken":true}')).toThrow("Saved tool requests");
	expect(() =>
		readToolParts(JSON.stringify([{ ...part, type: "unknown" }])),
	).toThrow("Saved tool requests");
});
