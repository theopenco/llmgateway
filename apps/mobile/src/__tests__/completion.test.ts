import { streamCompletion } from "@/api/completion";
import { ensureGatewayKey } from "@/api/gateway-key";

jest.mock("@/api/gateway-key", () => ({
	ensureGatewayKey: jest.fn(),
	clearGatewayKey: jest.fn(),
}));

class Request {
	public static latest: Request;
	public status = 200;
	public responseText = "";
	public timeout = 0;
	public onprogress?: () => void;
	public onload?: () => void;
	public onerror?: () => void;
	public ontimeout?: () => void;
	public open = jest.fn();
	public setRequestHeader = jest.fn();
	public abort = jest.fn();
	public send = jest.fn();
	public constructor() {
		Request.latest = this;
	}
	public finish(text: string, status = 200) {
		this.responseText = text;
		this.status = status;
		this.onload?.();
	}
}
const originalXHR = globalThis.XMLHttpRequest;
beforeAll(() => {
	globalThis.XMLHttpRequest = Request as unknown as typeof XMLHttpRequest;
});
afterAll(() => {
	globalThis.XMLHttpRequest = originalXHR;
});
beforeEach(() => {
	jest.clearAllMocks();
	jest.mocked(ensureGatewayKey).mockResolvedValue("test-token");
});

async function start(signal = new AbortController().signal) {
	const onDelta = jest.fn();
	const result = streamCompletion({
		projectId: "project",
		model: "auto",
		messages: [{ role: "user", content: "Hello" }],
		signal,
		onDelta,
		settings: {
			systemPrompt: "",
			temperature: 0.7,
			maxTokens: 512,
			reasoningEffort: "high",
			webSearch: true,
		},
	});
	await Promise.resolve();
	return { result, request: Request.latest, onDelta };
}

test("sends model controls and consumes incremental reasoning and text once", async () => {
	const { result, request, onDelta } = await start();
	expect(JSON.parse(request.send.mock.calls[0][0])).toMatchObject({
		temperature: 0.7,
		max_tokens: 512,
		reasoning_effort: "high",
		web_search: true,
	});
	request.responseText =
		'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n';
	request.onprogress?.();
	request.finish(
		request.responseText +
			'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
	);
	await result;
	expect(onDelta.mock.calls).toEqual([
		[{ content: "", reasoning: "Thinking" }],
		[{ content: "Hello", reasoning: "" }],
	]);
});

test("surfaces upstream validation errors", async () => {
	const { result, request } = await start();
	const rejected = expect(result).rejects.toThrow("Unsupported file format");
	request.finish('{"error":{"message":"Unsupported file format"}}', 400);
	await rejected;
});

test("rejects incomplete streams instead of reporting success", async () => {
	const { result, request } = await start();
	const rejected = expect(result).rejects.toThrow("interrupted");
	request.finish('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n');
	await rejected;
});

test("aborts the active request when the user stops", async () => {
	const controller = new AbortController();
	const { result, request } = await start(controller.signal);
	const rejected = expect(result).rejects.toThrow("Response stopped");
	controller.abort();
	await rejected;
	expect(request.abort).toHaveBeenCalledTimes(1);
});
