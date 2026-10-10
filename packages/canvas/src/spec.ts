import { compileSpecStream } from "@json-render/core";
import { z } from "zod";

import { catalog } from "./catalog.js";

import type { Spec } from "@json-render/core";

export type { Spec } from "@json-render/core";

const specSchema = z
	.object({
		root: z.string().min(1),
		elements: z.record(
			z.string(),
			z
				.object({
					type: z.string().min(1),
					props: z.record(z.string(), z.unknown()),
					children: z.array(z.string()).optional(),
				})
				.passthrough(),
		),
		state: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export function validateCanvas(value: unknown): Spec {
	const parsed = specSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			"Canvas must contain a root and an elements map with component types and props.",
		);
	}
	const spec = parsed.data;
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function visit(id: string, depth: number) {
		if (depth > 64 || visiting.has(id)) {
			throw new Error("Canvas contains a cycle or is nested too deeply.");
		}
		if (visited.has(id)) {
			return;
		}
		const element = spec.elements[id];
		if (!element) {
			throw new Error(`Canvas is missing the element: ${id}`);
		}
		if (!catalog.componentNames.includes(element.type)) {
			throw new Error(`Unknown Canvas component: ${element.type}`);
		}
		visiting.add(id);
		for (const child of element.children ?? []) {
			visit(child, depth + 1);
		}
		visiting.delete(id);
		visited.add(id);
	}
	visit(spec.root, 0);
	return spec;
}

function readCanvas(text: string): unknown {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		value = compileSpecStream(text);
	}
	return value;
}

export function parseCanvas(text: string): Spec {
	return validateCanvas(readCanvas(text));
}

export function partialCanvas(text: string): Spec | null {
	try {
		const spec = specSchema.parse(readCanvas(text));
		const root = spec.elements[spec.root];
		if (
			!root ||
			(root.children?.length && !root.children.some((id) => spec.elements[id]))
		) {
			return null;
		}
		return validateCanvas({
			...spec,
			elements: Object.fromEntries(
				Object.entries(spec.elements).map(([id, element]) => [
					id,
					{
						...element,
						...(element.children && {
							children: element.children.filter(
								(child) => spec.elements[child],
							),
						}),
					},
				]),
			),
		});
	} catch {
		// Keep the previous preview until the stream contains a valid tree.
		return null;
	}
}

export const previewCommand = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("render"),
		spec: z.unknown(),
		revision: z.number().int(),
	}),
	z.object({ type: z.literal("theme"), dark: z.boolean() }),
	z.object({
		type: z.literal("export"),
		id: z.string(),
		format: z.enum(["png", "pdf"]),
	}),
]);

export const previewEvent = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ready") }),
	z.object({ type: z.literal("rendered"), revision: z.number().int() }),
	z.object({
		type: z.literal("error"),
		message: z.string(),
		id: z.string().optional(),
	}),
	z.object({ type: z.literal("link"), url: z.string() }),
	z.object({
		type: z.literal("exported"),
		id: z.string(),
		format: z.enum(["png", "pdf"]),
		base64: z.string().min(1),
	}),
]);

export type PreviewEvent = z.infer<typeof previewEvent>;
export type PreviewCommand = z.infer<typeof previewCommand>;
