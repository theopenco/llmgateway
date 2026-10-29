import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { createOpenAPI, openapiPlugin } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";

import { getGatewayPublicBaseUrl } from "@llmgateway/shared/gateway-url";

import { customIcons } from "./custom-icons";
import { docs, meta } from "../.source/server";
import document from "../openapi.json";

import type { InferPageType } from "fumadocs-core/source";
import type { Document } from "fumadocs-openapi";

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
	source: toFumadocsSource(docs, meta),
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

export { getLLMText } from "./get-llm-text";

export const openapi = createOpenAPI({
	// Fumadocs upgrades the generated OpenAPI 3.0 document to its 3.2 types.
	input: () => ({
		"./openapi.json": {
			...document,
			servers: [{ url: getGatewayPublicBaseUrl() }],
		} as unknown as Document,
	}),
	proxyUrl: "/api/proxy",
});
