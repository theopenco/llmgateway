import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Linking } from "react-native";
import { WebView } from "react-native-webview";

import { canvasPreviewHTML } from "@/generated/canvas-preview";

import { previewEvent } from "@llmgateway/canvas/spec";

import type { PreviewCommand, Spec } from "@llmgateway/canvas/spec";

export interface CanvasPreviewHandle {
	export: (format: "png" | "pdf") => Promise<string>;
}
interface PendingExport {
	id: string;
	format: "png" | "pdf";
	resolve: (value: string) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}
const source = { html: canvasPreviewHTML, baseUrl: "https://canvas.invalid" };

export const CanvasPreview = function CanvasPreview({
	ref,
	spec,
	revision,
	dark = true,
	onError,
}: {
	spec: Spec;
	revision: number;
	dark?: boolean;
	onError: (error: Error) => void;
} & { ref?: React.RefObject<CanvasPreviewHandle | null> }) {
	const webRef = useRef<WebView<object>>(null);
	const pendingRef = useRef<PendingExport | null>(null);
	const [ready, setReady] = useState(false);
	const [rendered, setRendered] = useState(-1);
	const post = (command: PreviewCommand) =>
		webRef.current?.postMessage(JSON.stringify(command));
	const rejectExport = (error: Error) => {
		if (pendingRef.current) {
			clearTimeout(pendingRef.current.timeout);
			pendingRef.current.reject(error);
			pendingRef.current = null;
		}
	};
	useEffect(
		() => () =>
			rejectExport(new Error("Canvas was closed before the export finished.")),
		[],
	);
	useEffect(() => {
		if (ready) {
			post({ type: "render", spec, revision, dark });
		}
	}, [ready, spec, revision, dark]);
	useImperativeHandle(
		ref,
		() => ({
			export: async (format) => {
				if (!ready || rendered !== revision) {
					throw new Error("Wait for the canvas preview to finish rendering.");
				}
				if (pendingRef.current) {
					throw new Error("An export is already in progress.");
				}
				return await new Promise<string>((resolve, reject) => {
					const id = `${Date.now()}-${revision}`;
					pendingRef.current = {
						id,
						format,
						resolve,
						reject,
						timeout: setTimeout(
							() =>
								rejectExport(
									new Error("Canvas export timed out. Please try again."),
								),
							45_000,
						),
					};
					post({ type: "export", id, format });
				});
			},
		}),
		[ready, rendered, revision],
	);
	return (
		<WebView<object>
			ref={webRef}
			testID="canvas-preview"
			originWhitelist={["*"]}
			source={source}
			style={{ flex: 1, backgroundColor: dark ? "#101412" : "#ffffff" }}
			incognito
			sharedCookiesEnabled={false}
			allowFileAccess={false}
			javaScriptCanOpenWindowsAutomatically={false}
			onShouldStartLoadWithRequest={({ url }) =>
				url === "about:blank" ||
				url === "https://canvas.invalid" ||
				url === "https://canvas.invalid/" ||
				url.startsWith("https://canvas.invalid/#")
			}
			onContentProcessDidTerminate={() => {
				rejectExport(
					new Error("The preview was interrupted. Please export again."),
				);
				setReady(false);
				setRendered(-1);
				webRef.current?.reload();
			}}
			onError={({ nativeEvent }) => {
				const error = new Error(nativeEvent.description);
				setReady(false);
				setRendered(-1);
				rejectExport(error);
				onError(error);
			}}
			onMessage={({ nativeEvent }) => {
				try {
					const event = previewEvent.parse(JSON.parse(nativeEvent.data));
					if (event.type === "ready") {
						setReady(true);
					}
					if (event.type === "rendered") {
						setRendered(event.revision);
					}
					if (event.type === "error") {
						if (!event.id) {
							setRendered(-1);
						}
						if (!event.id || event.id === pendingRef.current?.id) {
							rejectExport(new Error(event.message));
							onError(new Error(event.message));
						}
					}
					if (event.type === "link") {
						if (!/^https?:\/\//i.test(event.url)) {
							throw new Error("This preview link must use HTTP or HTTPS.");
						}
						void Linking.openURL(event.url).catch(onError);
					}
					if (
						event.type === "exported" &&
						event.id === pendingRef.current?.id
					) {
						if (
							event.format !== pendingRef.current.format ||
							!(event.format === "png"
								? event.base64.startsWith("iVBORw0KGgo")
								: event.base64.startsWith("JVBERi0"))
						) {
							throw new Error("The preview returned an invalid export.");
						}
						clearTimeout(pendingRef.current.timeout);
						pendingRef.current.resolve(event.base64);
						pendingRef.current = null;
					}
				} catch (cause) {
					const error =
						cause instanceof Error
							? cause
							: new Error("Invalid canvas response.");
					rejectExport(error);
					onError(error);
				}
			}}
		/>
	);
};
