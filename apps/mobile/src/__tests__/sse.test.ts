import { parseDelta, SSEDecoder } from "@/api/sse";

describe("stream decoding", () => {
	test("preserves messages across every possible network split", () => {
		const stream =
			'data: {"choices":[{"delta":{"content":"Hello 🌍"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
		for (let split = 0; split <= stream.length; split++) {
			const decoder = new SSEDecoder();
			const frames = [
				...decoder.push(stream.slice(0, split)),
				...decoder.push(stream.slice(split)),
			];
			expect(frames).toEqual([
				'{"choices":[{"delta":{"content":"Hello 🌍"}}]}',
				"[DONE]",
			]);
		}
	});
	test("ignores heartbeat comments and joins multiline data", () => {
		const decoder = new SSEDecoder();
		expect(
			decoder.push(
				": heartbeat\n\nevent: update\ndata: first\ndata: second\n\n",
			),
		).toEqual(["first\nsecond"]);
	});
	test("keeps content and reasoning separate", () => {
		expect(
			parseDelta(
				'{"choices":[{"delta":{"content":"Answer", "reasoning_content":"Thinking"}}]}',
			),
		).toEqual({ content: "Answer", reasoning: "Thinking" });
		expect(parseDelta("[DONE]")).toBeNull();
	});
	test("surfaces provider errors inside a successful HTTP stream", () => {
		expect(() =>
			parseDelta('{"error":{"message":"Model unavailable"}}'),
		).toThrow("Model unavailable");
		expect(() => parseDelta("{")).toThrow();
		expect(() => parseDelta("null")).toThrow("Invalid response");
	});
});
