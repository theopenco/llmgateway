import { defineCatalog } from "@json-render/core";
import {
	schema as imageSchema,
	standardComponentDefinitions as imageComponents,
} from "@json-render/image";
import { renderToSvg, renderToPng } from "@json-render/image/render";
import {
	schema as pdfSchema,
	standardComponentDefinitions as pdfComponents,
} from "@json-render/react-pdf";
import { renderToBuffer } from "@json-render/react-pdf";
import { NextResponse } from "next/server";

import type { Spec } from "@json-render/core";

const pdfCatalog = defineCatalog(pdfSchema, {
	components: pdfComponents,
});

const imageCatalog = defineCatalog(imageSchema, {
	components: imageComponents,
});

function specToSimpleSpec(spec: Spec): Spec {
	const simpleElements: Record<string, unknown> = {};

	for (const [key, el] of Object.entries(spec.elements)) {
		const element = el as {
			type: string;
			props?: Record<string, unknown>;
			children?: string[];
		};
		const type = element.type;

		const typeMap: Record<string, string> = {
			Stack: "Column",
			Grid: "Row",
			Card: "View",
			Heading: "Heading",
			Text: "Text",
			Image: "Image",
			Button: "Text",
			Link: "Link",
			Input: "Text",
			Textarea: "Text",
			Select: "Text",
			Progress: "Text",
			Badge: "Text",
			Alert: "View",
			Separator: "Divider",
		};

		const mappedType = typeMap[type] ?? "Text";
		const props: Record<string, unknown> = {};

		if (element.props) {
			if ("text" in element.props) {
				props.text = element.props.text;
			}
			if ("title" in element.props) {
				props.text = element.props.title;
			}
			if ("label" in element.props) {
				props.text = element.props.label;
			}
			if ("level" in element.props) {
				props.level = element.props.level;
			}
			if ("src" in element.props) {
				props.src = element.props.src;
			}
			if ("alt" in element.props) {
				props.alt = element.props.alt;
			}
			if ("description" in element.props && mappedType === "View") {
				props.text = `${element.props.title ?? ""} - ${element.props.description}`;
			}
		}

		const mapped: Record<string, unknown> = {
			type: mappedType,
			props,
		};

		if (element.children) {
			mapped.children = element.children;
		}

		simpleElements[key] = mapped;
	}

	return {
		root: spec.root,
		elements: simpleElements as Spec["elements"],
	};
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { spec, format } = body as {
			spec: Spec;
			format: "pdf" | "png" | "svg";
		};

		const simpleSpec = specToSimpleSpec(spec);

		if (format === "pdf") {
			const buffer = await renderToBuffer(simpleSpec, {
				includeStandard: true,
			});
			return new NextResponse(Buffer.from(buffer), {
				headers: {
					"Content-Type": "application/pdf",
					"Content-Disposition": "attachment; filename=canvas-export.pdf",
				},
			});
		}

		if (format === "svg") {
			const svg = await renderToSvg(simpleSpec, {
				includeStandard: true,
				width: 1200,
				height: 800,
			});
			return new NextResponse(svg, {
				headers: {
					"Content-Type": "image/svg+xml",
					"Content-Disposition": "attachment; filename=canvas-export.svg",
				},
			});
		}

		// PNG
		const png = await renderToPng(simpleSpec, {
			includeStandard: true,
			width: 1200,
			height: 800,
		});
		return new NextResponse(Buffer.from(png), {
			headers: {
				"Content-Type": "image/png",
				"Content-Disposition": "attachment; filename=canvas-export.png",
			},
		});
	} catch (error) {
		console.error("Canvas export error:", error);
		return NextResponse.json(
			{
				error: "Export failed",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}
