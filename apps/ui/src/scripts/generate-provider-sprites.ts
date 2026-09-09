import { writeFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProviderIcons } from "@llmgateway/shared/components";

const dimensions: Record<string, { viewBox: string } | { src: string }> = {};
const symbols = Object.entries(ProviderIcons).map(([name, Icon]) => {
	let svg = renderToStaticMarkup(createElement(Icon));
	if (!svg.startsWith("<svg")) {
		const src = /<img[^>]+src="([^"]+)"/.exec(svg)?.[1];
		if (!src) {
			throw new Error(`Unsupported provider logo: ${name}`);
		}
		dimensions[name] = { src };
		return "";
	}
	for (const [, id] of Array.from(svg.matchAll(/\bid="([^"]+)"/g))) {
		svg = svg
			.replaceAll(`id="${id}"`, `id="${name}-${id}"`)
			.replaceAll(`#${id})`, `#${name}-${id})`)
			.replaceAll(`="#${id}"`, `="#${name}-${id}"`);
	}
	dimensions[name] = {
		viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 24 24",
	};
	return svg
		.replace(/^<svg[^>]*>/, (tag) => tag.replace(/ id="[^"]*"/g, ""))
		.replace(/^<svg\b/, `<symbol id="${name}"`)
		.replace(/<\/svg>$/, "</symbol>");
});

writeFileSync(
	"public/provider-logos.svg",
	`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${symbols.join("")}</svg>\n`,
);
writeFileSync(
	"src/lib/provider-logo-dimensions.json",
	JSON.stringify(dimensions, null, "\t") + "\n",
);
