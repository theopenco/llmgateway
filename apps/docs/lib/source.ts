import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { createMDXSource } from "fumadocs-mdx/runtime/next";
import { createOpenAPI, openapiPlugin } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";

import { customIcons } from "./custom-icons";
import { docs, meta } from "../.source";

import type { InferPageType } from "fumadocs-core/source";

export const source = loader({
	icon(icon) {
		if (!icon) {
			return undefined;
		}
		if (icon in icons) {
			return createElement(icons[icon as keyof typeof icons]);
		}

		if (icon in customIcons) {
			const C = customIcons[icon];
			return createElement(C);
		}

		return undefined;
	},
	baseUrl: "/",
	source: createMDXSource(docs, meta),
	plugins: [lucideIconsPlugin(), openapiPlugin()],
});

export function getPageImage(page: InferPageType<typeof source>) {
	const segments = [...page.slugs, "image.png"];

	return {
		segments,
		url: `/og/docs/${segments.join("/")}`,
		title: page.data.title,
		description: page.data.description,
	};
}

export async function getLLMText(page: InferPageType<typeof source>) {
	const processed = await page.data.getText("processed");

	return `# ${page.data.title} (${page.url})
	
${processed}`;
}

export const openapi = createOpenAPI({
	input: ["./openapi.json"],
});
