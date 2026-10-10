import { act, render } from "@testing-library/react-native";
import { useImperativeHandle } from "react";
import { Linking, View } from "react-native";
import { WebView } from "react-native-webview";

import { CanvasPreview } from "@/components/CanvasPreview";

import type { CanvasPreviewHandle } from "@/components/CanvasPreview";
import type { Ref } from "react";
import type { WebViewMessageEvent, WebViewProps } from "react-native-webview";

jest.mock("react-native-webview", () => ({ WebView: jest.fn() }));
jest.mock("@/generated/canvas-preview", () => ({
	canvasPreviewHTML: "<html>Preview</html>",
}));
jest.useFakeTimers();
const postMessage = jest.fn();
const reload = jest.fn();
let webProps: WebViewProps;
const mockWebView = WebView as unknown as jest.Mock;
const spec = {
	root: "text",
	elements: { text: { type: "Text", props: { text: "Canvas" } } },
};
beforeEach(() => {
	jest.clearAllMocks();
	mockWebView.mockImplementation(function MockWebView(
		props: WebViewProps & {
			ref: Ref<{ postMessage: typeof postMessage; reload: typeof reload }>;
		},
	) {
		webProps = props;
		useImperativeHandle(props.ref, () => ({ postMessage, reload }));
		return <View testID="web-preview" />;
	});
});
async function event(value: unknown) {
	await act(() =>
		webProps.onMessage?.({
			nativeEvent: { data: JSON.stringify(value) },
		} as WebViewMessageEvent),
	);
}
async function show() {
	const ref: { current: CanvasPreviewHandle | null } = { current: null };
	const onError = jest.fn();
	const view = await render(
		<CanvasPreview ref={ref} spec={spec} revision={1} onError={onError} />,
	);
	await event({ type: "ready" });
	await event({ type: "rendered", revision: 1 });
	return { ref, onError, view };
}

test("sends specs as bridge data after readiness and blocks remote navigation", async () => {
	await show();
	expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
		type: "theme",
		dark: true,
	});
	expect(JSON.parse(postMessage.mock.calls[1][0])).toEqual({
		type: "render",
		spec,
		revision: 1,
	});
	expect(webProps.sharedCookiesEnabled).toBe(false);
	expect(webProps.source).toMatchObject({
		html: expect.stringContaining('class="dark"'),
	});
	const navigate = webProps.onShouldStartLoadWithRequest!;
	expect(
		navigate({ url: "https://example.com" } as Parameters<typeof navigate>[0]),
	).toBe(false);
	expect(
		navigate({ url: "about:blank" } as Parameters<typeof navigate>[0]),
	).toBe(true);
});

test("only resolves the requested export and ignores unsolicited data", async () => {
	const { ref } = await show();
	const promise = ref.current!.export("png");
	const command = JSON.parse(postMessage.mock.calls.at(-1)![0]) as {
		id: string;
	};
	const finished = jest.fn();
	void promise.then(finished);
	await event({
		type: "exported",
		id: "stale",
		format: "png",
		base64: "iVBORw0KGgoAAA",
	});
	expect(finished).not.toHaveBeenCalled();
	await event({
		type: "exported",
		id: command.id,
		format: "png",
		base64: "iVBORw0KGgoAAA",
	});
	expect(await promise).toBe("iVBORw0KGgoAAA");
});

test("rejects a mismatched export format without saving it", async () => {
	const { ref, onError } = await show();
	const promise = ref.current!.export("pdf");
	const rejected = expect(promise).rejects.toThrow("invalid export");
	const command = JSON.parse(postMessage.mock.calls.at(-1)![0]) as {
		id: string;
	};
	await event({
		type: "exported",
		id: command.id,
		format: "png",
		base64: "iVBORw0KGgoAAA",
	});
	await rejected;
	expect(onError).toHaveBeenCalled();
});

test("rejects interrupted exports when the preview closes", async () => {
	const { ref, view } = await show();
	const promise = ref.current!.export("pdf");
	const rejected = expect(promise).rejects.toThrow("closed");
	await view.unmount();
	await rejected;
});

test("recovers a terminated WebView and waits for its new preview", async () => {
	const { ref } = await show();
	await act(() =>
		webProps.onContentProcessDidTerminate?.(
			{} as Parameters<
				NonNullable<WebViewProps["onContentProcessDidTerminate"]>
			>[0],
		),
	);
	expect(reload).toHaveBeenCalled();
	await expect(ref.current!.export("png")).rejects.toThrow("finish rendering");
});

test("rejects executable links and surfaces external opening failures", async () => {
	const { onError } = await show();
	const open = jest
		.spyOn(Linking, "openURL")
		.mockRejectedValue(new Error("Browser unavailable"));
	await event({ type: "link", url: "javascript:alert(1)" });
	expect(open).not.toHaveBeenCalled();
	await event({ type: "link", url: "https://example.com" });
	expect(onError).toHaveBeenLastCalledWith(new Error("Browser unavailable"));
	open.mockRestore();
});

test("theme changes do not send a new render or replace the interactive preview", async () => {
	const { view, ref, onError } = await show();
	const source = webProps.source;
	postMessage.mockClear();
	await view.rerender(
		<CanvasPreview
			ref={ref}
			spec={spec}
			revision={1}
			dark={false}
			onError={onError}
		/>,
	);
	expect(postMessage.mock.calls.map(([value]) => JSON.parse(value))).toEqual([
		{ type: "theme", dark: false },
	]);
	expect(reload).not.toHaveBeenCalled();
	expect(webProps.source).toBe(source);
	const promise = ref.current!.export("png");
	const command = JSON.parse(postMessage.mock.calls.at(-1)![0]) as {
		id: string;
	};
	await event({
		type: "exported",
		id: command.id,
		format: "png",
		base64: "iVBORw0KGgoAAA",
	});
	expect(await promise).toBe("iVBORw0KGgoAAA");
});
