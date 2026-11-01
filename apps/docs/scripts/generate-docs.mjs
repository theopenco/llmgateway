import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createOpenAPI } from "fumadocs-openapi/server";
import { generateFiles } from "fumadocs-openapi";
import { rimraf } from "rimraf";

const openapi = createOpenAPI({
	input: ["./openapi.json"],
	proxyUrl: "/api/proxy",
});

const out = "./content/(gateway)/(api)";

function describeOperation(spec, path, method) {
	const operation = spec.paths?.[path]?.[method];
	const base = (operation?.description || operation?.summary || "")
		.replace(/\s+/g, " ")
		.trim();
	const sentence = base && !/[.!?]$/.test(base) ? `${base}.` : base;
	const suffix = `API reference for ${method.toUpperCase()} ${path}: request parameters, response schema and code samples.`;
	const combined = sentence ? `${sentence} ${suffix}` : suffix;
	if (combined.length <= 160) {
		return combined;
	}
	const sentences = sentence.split(/(?<=[.!?])\s+/);
	let fitted = sentences[0];
	for (const next of sentences.slice(1)) {
		if (`${fitted} ${next}`.length > 160) {
			break;
		}
		fitted = `${fitted} ${next}`;
	}
	return fitted;
}

async function addDescriptionsFromOpenApi() {
	const spec = JSON.parse(await readFile("./openapi.json", "utf8"));
	const entries = await readdir(out);
	for (const entry of entries) {
		if (!entry.endsWith(".mdx") || entry === "index.mdx") {
			continue;
		}
		const filePath = join(out, entry);
		const source = await readFile(filePath, "utf8");
		const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) {
			continue;
		}
		const [, frontmatter, body] = match;
		const operationMatch = body.match(
			/operations=\{\[\{"path":"([^"]+)","method":"([a-z]+)"\}\]\}/,
		);
		if (!operationMatch) {
			continue;
		}
		const description = describeOperation(
			spec,
			operationMatch[1],
			operationMatch[2],
		);
		if (!description) {
			continue;
		}
		let inDescription = false;
		const lines = frontmatter.split("\n").filter((line) => {
			if (line.startsWith("description:")) {
				inDescription = true;
				return false;
			}
			if (inDescription && /^\s/.test(line)) {
				return false;
			}
			inDescription = false;
			return true;
		});
		const titleIndex = lines.findIndex((line) => line.startsWith("title:"));
		lines.splice(
			titleIndex + 1,
			0,
			`description: ${JSON.stringify(description)}`,
		);
		await writeFile(filePath, `---\n${lines.join("\n")}\n---\n${body}`);
	}
}

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

	await addDescriptionsFromOpenApi();
}

void generate();
