import { mkdirSync, rmSync, writeFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProviderIcons } from "@llmgateway/shared/components";

const STANDALONE_DIR = "public/provider-logos";

rmSync(STANDALONE_DIR, { recursive: true, force: true });
mkdirSync(STANDALONE_DIR, { recursive: true });

const dimensions: Record<string, { viewBox: string; src?: string }> = {};
const symbols = Object.entries(ProviderIcons).map(([name, Icon]) => {
	let svg = renderToStaticMarkup(createElement(Icon));
	if (!svg.startsWith("<svg")) {
		throw new Error(`Unsupported provider logo: ${name}`);
	}
	const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 24 24";
	// Gradients don't render through <use> of an external sprite in every
	// browser, so gradient logos ship as standalone files loaded with <img>.
	if (/Gradient\b/.test(svg)) {
		const file = svg.includes("xmlns=")
			? svg
			: svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
		writeFileSync(`${STANDALONE_DIR}/${name}.svg`, `${file}\n`);
		dimensions[name] = { viewBox, src: `/provider-logos/${name}.svg` };
		return "";
	}
	for (const [, id] of Array.from(svg.matchAll(/\bid="([^"]+)"/g))) {
		svg = svg
			.replaceAll(`id="${id}"`, `id="${name}-${id}"`)
			.replaceAll(`#${id})`, `#${name}-${id})`)
			.replaceAll(`="#${id}"`, `="#${name}-${id}"`);
	}
	dimensions[name] = { viewBox };
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
