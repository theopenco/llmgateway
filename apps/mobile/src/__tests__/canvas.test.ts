import { generateCanvas } from "@/api/canvas";
import { streamCompletion } from "@/api/completion";

import {
	parseCanvas,
	partialCanvas,
	validateCanvas,
} from "@llmgateway/canvas/spec";
import { templates } from "@llmgateway/canvas/templates";

jest.mock("@/api/completion", () => ({ streamCompletion: jest.fn() }));
const spec = {
	root: "root",
	elements: {
		root: { type: "Stack", props: {}, children: ["heading"] },
		heading: { type: "Heading", props: { text: "Canvas fixture" } },
	},
	state: { name: "Guest" },
};
beforeEach(() => jest.resetAllMocks());

test.each(templates)("accepts the shared $name template", (template) => {
	expect(validateCanvas(template.spec)).toEqual(template.spec);
});

test("keeps bindings, events, visibility and state when parsing JSON", () => {
	const value = {
		...spec,
		elements: {
			...spec.elements,
			heading: {
				type: "Text",
				props: { text: { $state: "/name" } },
				visible: { $state: "/name" },
				on: {
					press: {
						action: "setState",
						params: { statePath: "/name", value: "Edited" },
					},
				},
			},
		},
	};
	expect(parseCanvas(JSON.stringify(value))).toEqual(value);
});

test("waits for referenced children and accepts completed JSONL patches", () => {
	const first =
		[
			JSON.stringify({ op: "add", path: "/root", value: "root" }),
			JSON.stringify({
				op: "add",
				path: "/elements/root",
				value: spec.elements.root,
			}),
		].join("\n") + "\n";
	expect(partialCanvas(first)).toBeNull();
	const complete =
		first +
		JSON.stringify({
			op: "add",
			path: "/elements/heading",
			value: spec.elements.heading,
		}) +
		"\n";
	expect(parseCanvas(complete).elements.heading).toEqual(spec.elements.heading);
});

test("rejects missing roots, cycles, missing children and unknown components", () => {
	expect(() => validateCanvas({ root: "missing", elements: {} })).toThrow(
		"missing",
	);
	expect(() =>
		validateCanvas({ ...spec, elements: { root: spec.elements.root } }),
	).toThrow("heading");
	expect(() =>
		validateCanvas({
			...spec,
			elements: { root: { type: "Stack", props: {}, children: ["root"] } },
		}),
	).toThrow("cycle");
	expect(() =>
		validateCanvas({
			...spec,
			elements: { root: { type: "Script", props: {} } },
		}),
	).toThrow("Unknown Canvas component");
	expect(() => parseCanvas("This is not a UI spec")).toThrow();
});

test("shows completed branches while later children are still streaming", () => {
	const partial = {
		...spec,
		elements: {
			...spec.elements,
			root: { ...spec.elements.root, children: ["heading", "later"] },
		},
	};
	expect(
		partialCanvas(JSON.stringify(partial))?.elements.root.children,
	).toEqual(["heading"]);
	expect(() => parseCanvas(JSON.stringify(partial))).toThrow("later");
});

test("generates with the selected billing project, model and canonical component prompt", async () => {
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: JSON.stringify(spec), reasoning: "" });
	});
	const onProgress = jest.fn();
	const signal = new AbortController().signal;
	expect(
		await generateCanvas({
			projectId: "project",
			model: "model",
			prompt: "  A dashboard  ",
			signal,
			onProgress,
		}),
	).toEqual(spec);
	expect(streamCompletion).toHaveBeenCalledWith(
		expect.objectContaining({
			projectId: "project",
			model: "model",
			signal,
			messages: [
				expect.objectContaining({
					role: "system",
					content: expect.stringContaining("BarChart"),
				}),
				{ role: "user", content: "A dashboard" },
			],
		}),
	);
	expect(onProgress).toHaveBeenLastCalledWith(
		JSON.stringify(spec, null, 2),
		spec,
	);
});

test("preserves the last valid preview when the stream fails", async () => {
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: JSON.stringify(spec), reasoning: "" });
		throw new Error("Response stopped.");
	});
	const onProgress = jest.fn();
	await expect(
		generateCanvas({
			projectId: "project",
			model: "model",
			prompt: "A dashboard",
			signal: new AbortController().signal,
			onProgress,
		}),
	).rejects.toThrow("stopped");
	expect(onProgress).toHaveBeenCalledWith(JSON.stringify(spec), spec);
});

test("surfaces invalid final output and rejects empty prompts before calling a model", async () => {
	await expect(
		generateCanvas({
			projectId: "project",
			model: "model",
			prompt: " ",
			signal: new AbortController().signal,
			onProgress: jest.fn(),
		}),
	).rejects.toThrow("Describe");
	expect(streamCompletion).not.toHaveBeenCalled();
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: "not JSON", reasoning: "" });
	});
	await expect(
		generateCanvas({
			projectId: "project",
			model: "model",
			prompt: "A dashboard",
			signal: new AbortController().signal,
			onProgress: jest.fn(),
		}),
	).rejects.toThrow("Canvas");
});
