import { JSONUIProvider, Renderer } from "@json-render/react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Component, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { registry } from "@/lib/canvas/registry";

import { previewCommand, validateCanvas } from "@llmgateway/canvas/spec";

import type { PreviewEvent, Spec } from "@llmgateway/canvas/spec";
import type { ReactNode } from "react";

declare global {
	interface Window {
		ReactNativeWebView?: { postMessage: (message: string) => void };
	}
}

function post(event: PreviewEvent) {
	window.ReactNativeWebView?.postMessage(JSON.stringify(event));
}

class PreviewBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	public state = { failed: false };
	public static getDerivedStateFromError() {
		return { failed: true };
	}
	public componentDidCatch(error: Error) {
		post({
			type: "error",
			message: `Canvas could not render: ${error.message}`,
		});
	}
	public render() {
		return this.state.failed ? (
			<p role="alert">Edit the JSON or generate a new canvas to continue.</p>
		) : (
			this.props.children
		);
	}
}

async function exportCanvas(id: string, format: "png" | "pdf") {
	try {
		const node = document.getElementById("preview");
		if (!node?.childElementCount) {
			throw new Error("Create a canvas before exporting.");
		}
		await document.fonts.ready;
		const backgroundColor = getComputedStyle(document.body).backgroundColor;
		const width = node.scrollWidth;
		const height = node.scrollHeight;
		const png = await toPng(node, {
			backgroundColor,
			width,
			height,
			pixelRatio: 2,
			skipFonts: true,
		});
		let data = png;
		if (format === "pdf") {
			// eslint-disable-next-line new-cap
			const pdf = new jsPDF({
				orientation: width > height ? "landscape" : "portrait",
				unit: "pt",
				format: [width * 0.75, height * 0.75],
			});
			pdf.addImage(png, "PNG", 0, 0, width * 0.75, height * 0.75);
			data = pdf.output("datauristring");
		}
		post({
			type: "exported",
			id,
			format,
			base64: data.slice(data.indexOf(",") + 1),
		});
	} catch (error) {
		post({
			type: "error",
			id,
			message: error instanceof Error ? error.message : "Canvas export failed.",
		});
	}
}

function Rendered({ revision }: { revision: number }) {
	useEffect(() => {
		post({ type: "rendered", revision });
	}, [revision]);
	return null;
}

function Preview() {
	const [canvas, setCanvas] = useState<{ spec: Spec; revision: number }>();
	useEffect(() => {
		const receive = (event: MessageEvent) => {
			try {
				const command = previewCommand.parse(JSON.parse(String(event.data)));
				if (command.type === "export") {
					void exportCanvas(command.id, command.format);
				} else if (command.type === "theme") {
					document.documentElement.classList.toggle("dark", command.dark);
				} else {
					setCanvas({
						spec: validateCanvas(command.spec),
						revision: command.revision,
					});
				}
			} catch (error) {
				post({
					type: "error",
					message:
						error instanceof Error
							? error.message
							: "Canvas could not be opened.",
				});
			}
		};
		const link = (event: MouseEvent) => {
			const anchor =
				event.target instanceof Element ? event.target.closest("a") : null;
			if (anchor && !anchor.getAttribute("href")?.startsWith("#")) {
				event.preventDefault();
				post({ type: "link", url: anchor.href });
			}
		};
		window.addEventListener("message", receive);
		document.addEventListener("click", link);
		post({ type: "ready" });
		return () => {
			window.removeEventListener("message", receive);
			document.removeEventListener("click", link);
		};
	}, []);
	return canvas ? (
		<PreviewBoundary key={canvas.revision}>
			<JSONUIProvider
				registry={registry}
				initialState={canvas.spec.state ?? {}}
			>
				<Renderer spec={canvas.spec} registry={registry} />
				<Rendered revision={canvas.revision} />
			</JSONUIProvider>
		</PreviewBoundary>
	) : null;
}

const root = document.getElementById("preview");
if (!root) {
	throw new Error("Canvas preview container is missing.");
}
createRoot(root).render(<Preview />);
