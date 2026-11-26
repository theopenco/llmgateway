import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const requiredArguments = new Map([
	["getActiveCompliancePolicy", 2],
	["getEffectiveRetentionLevel", 2],
	["isZeroDataRetentionEnabled", 2],
	["assertProviderCompliant", 4],
]);

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? sourceFiles(path)
			: entry.name.endsWith(".ts") &&
				  !entry.name.endsWith(".spec.ts") &&
				  !entry.name.endsWith(".e2e.ts") &&
				  entry.name !== "compliance.ts"
				? [path]
				: [];
	});
}

describe("gateway compliance propagation", () => {
	it("passes request API key policy to every endpoint compliance check", () => {
		const missing: string[] = [];
		let checked = 0;
		for (const path of sourceFiles(sourceRoot)) {
			const source = ts.createSourceFile(
				path,
				readFileSync(path, "utf8"),
				ts.ScriptTarget.Latest,
				true,
			);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
					const count = requiredArguments.get(node.expression.text);
					if (count) {
						checked++;
						const key = node.arguments[count - 1];
						if (
							!key ||
							key.kind === ts.SyntaxKind.NullKeyword ||
							key.getText(source) === "undefined"
						) {
							const { line } = source.getLineAndCharacterOfPosition(
								node.getStart(source),
							);
							missing.push(
								`${relative(sourceRoot, path)}:${line + 1} ${node.expression.text}`,
							);
						}
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
		}
		expect(checked).toBeGreaterThan(30);
		expect(missing).toEqual([]);
	});
});
