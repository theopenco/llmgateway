import { describe, expect, it } from "vitest";

import {
	flushTaggedStreamingRemainder,
	splitTaggedStreamingContentChunk,
	splitReasoningFromTaggedContent,
} from "./reasoning-details.js";

describe("reasoning-details", () => {
	it("splits reasoning tags from a complete response", () => {
		const result = splitReasoningFromTaggedContent(
			"<think>step 1</think>\n<thinking>step 2</thinking>\nFinal answer",
		);

		expect(result.reasoningContent).toBe("step 1\n\nstep 2");
		expect(result.content).toBe("Final answer");
	});

	it("splits tagged streaming chunks into reasoning and content", () => {
		const state = {
			inReasoning: false,
			pending: "",
		};

		const chunk1 = splitTaggedStreamingContentChunk("<think>step 1", state);
		const chunk2 = splitTaggedStreamingContentChunk("</think> answer", state);

		expect(chunk1.reasoning).toBe("step 1");
		expect(chunk1.content).toBeUndefined();
		expect(chunk2.reasoning).toBeUndefined();
		expect(chunk2.content).toBe(" answer");
	});

	it("handles think tags split across chunk boundaries", () => {
		const state = {
			inReasoning: false,
			pending: "",
		};

		const chunk1 = splitTaggedStreamingContentChunk("<thi", state);
		const chunk2 = splitTaggedStreamingContentChunk(
			"nk>reasoning</think>done",
			state,
		);

		expect(chunk1.content).toBeUndefined();
		expect(chunk1.reasoning).toBeUndefined();
		expect(chunk2.reasoning).toBe("reasoning");
		expect(chunk2.content).toBe("done");
	});

	it("supports thinking tags in streaming chunks", () => {
		const state = {
			inReasoning: false,
			pending: "",
		};

		const chunk1 = splitTaggedStreamingContentChunk("<thinking>reason", state);
		const chunk2 = splitTaggedStreamingContentChunk(
			"ing</thinking>done",
			state,
		);

		expect(chunk1.reasoning).toBe("reason");
		expect(chunk2.reasoning).toBe("ing");
		expect(chunk2.content).toBe("done");
	});

	it("flushes any buffered trailing content at stream end", () => {
		const state = {
			inReasoning: false,
			pending: "",
		};

		splitTaggedStreamingContentChunk("answer<thi", state);
		const remainder = flushTaggedStreamingRemainder(state);

		expect(remainder.content).toBe("<thi");
		expect(remainder.reasoning).toBeUndefined();
	});

	it("flushes any buffered trailing reasoning at stream end", () => {
		const state = {
			inReasoning: false,
			pending: "",
		};

		splitTaggedStreamingContentChunk("<thinking>reasoning</thin", state);
		const remainder = flushTaggedStreamingRemainder(state);

		expect(remainder.reasoning).toBe("</thin");
		expect(remainder.content).toBeUndefined();
	});
});
