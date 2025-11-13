import { cp } from "node:fs/promises";

import { createOpenAPI } from "fumadocs-openapi/server";
import { generateFiles } from "fumadocs-openapi";
import { rimraf } from "rimraf";

const openapi = createOpenAPI({
	input: ["./openapi.json"],
	proxyUrl: "/api/proxy",
});

const out = "./content/(api)";

async function generate() {
	await rimraf(out, {
		filter(v) {
			return !v.endsWith("index.mdx") && !v.endsWith("meta.json");
		},
	});

	await cp("../gateway/openapi.json", "./openapi.json");

	await generateFiles({
		input: openapi,
		output: out,
		includeDescription: true,
	});
}

void generate();
