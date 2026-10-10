import { client, setSessionToken } from "@/api/client";
import { xhrStreamFetch } from "@/api/xhr-stream";

class FakeXHR {
	public static latest: FakeXHR;
	public status = 200;
	public responseText = "";
	public timeout = 0;
	public onprogress?: () => void;
	public onload?: () => void;
	public onerror?: () => void;
	public ontimeout?: () => void;
	public open = jest.fn();
	public setRequestHeader = jest.fn();
	public getResponseHeader = jest.fn(() => "text/event-stream");
	public abort = jest.fn();
	public send = jest.fn();
	public constructor() {
		FakeXHR.latest = this;
	}
	public finish(text: string, status = 200) {
		this.responseText = text;
		this.status = status;
		this.onload?.();
	}
}
const originalXHR = globalThis.XMLHttpRequest;
beforeAll(() => {
	globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
});
afterAll(() => {
	globalThis.XMLHttpRequest = originalXHR;
});
beforeEach(() => setSessionToken("test-token"));
afterEach(() => setSessionToken(null));

async function start(signal = new AbortController().signal) {
	const onEvent = jest.fn();
	const previous = FakeXHR.latest;
	const result = client.POST("/lounge/chat", {
		body: {
			model: "auto",
			messages: [
				{ id: "user", role: "user", parts: [{ type: "text", text: "Hello" }] },
			],
			connectors: ["gmail"],
		},
		headers: { "x-llmgateway-key": "test-token" },
		signal,
		parseAs: "text",
		fetch: xhrStreamFetch(onEvent),
	});
	for (let i = 0; i < 30 && FakeXHR.latest === previous; i++) {
		await Promise.resolve();
	}
	expect(FakeXHR.latest).not.toBe(previous);
	return { result, request: FakeXHR.latest, onEvent };
}

test("keeps typed client authentication and delivers split SSE events once", async () => {
	const { result, request, onEvent } = await start();
	expect(request.setRequestHeader).toHaveBeenCalledWith(
		"authorization",
		"Bearer test-token",
	);
	expect(request.setRequestHeader).toHaveBeenCalledWith(
		"x-llmgateway-key",
		"test-token",
	);
	expect(JSON.parse(request.send.mock.calls[0][0])).toMatchObject({
		connectors: ["gmail"],
	});
	request.responseText = 'data: {"type":"text-delta","delta":"Hel';
	request.onprogress?.();
	expect(onEvent).not.toHaveBeenCalled();
	request.finish(request.responseText + 'lo"}\r\n\r\ndata: [DONE]\r\n\r\n');
	await expect(result).resolves.toMatchObject({ response: { status: 200 } });
	expect(onEvent.mock.calls).toEqual([
		['{"type":"text-delta","delta":"Hello"}'],
	]);
});

test("surfaces typed API errors without treating them as stream events", async () => {
	const { result, request, onEvent } = await start();
	const rejected = expect(result).rejects.toMatchObject({
		status: 401,
		message: "Sign in again",
	});
	request.finish('{"message":"Sign in again"}', 401);
	await rejected;
	expect(onEvent).not.toHaveBeenCalled();
});

test.each([0, 200])(
	"rejects an incomplete response with status %s",
	async (status) => {
		const { result, request } = await start();
		const rejected = expect(result).rejects.toThrow(
			status === 0 ? "connection" : "interrupted",
		);
		request.finish('data: {"type":"text-delta","delta":"Partial"}\n\n', status);
		await rejected;
	},
);

test("stops transport once and ignores events arriving after cancellation", async () => {
	const controller = new AbortController();
	const { result, request, onEvent } = await start(controller.signal);
	const rejected = expect(result).rejects.toThrow("Response stopped");
	controller.abort();
	request.finish(
		'data: {"type":"text-delta","delta":"Late"}\n\ndata: [DONE]\n\n',
	);
	await rejected;
	expect(request.abort).toHaveBeenCalledTimes(1);
	expect(onEvent).not.toHaveBeenCalled();
});

test("closes transport when an event is invalid", async () => {
	const previous = FakeXHR.latest;
	const pending = xhrStreamFetch(() => {
		throw new Error("Invalid proposal");
	})(new Request("https://example.com/chat"));
	for (let i = 0; i < 30 && FakeXHR.latest === previous; i++) {
		await Promise.resolve();
	}
	expect(FakeXHR.latest).not.toBe(previous);
	const rejected = expect(pending).rejects.toThrow("Invalid proposal");
	FakeXHR.latest.finish("data: invalid\n\ndata: [DONE]\n\n");
	await rejected;
	expect(FakeXHR.latest.abort).toHaveBeenCalledTimes(1);
});
