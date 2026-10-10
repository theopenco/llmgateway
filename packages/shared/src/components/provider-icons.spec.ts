import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as icons from "./provider-icons";

const source = readFileSync(
	fileURLToPath(new URL("./provider-icons.tsx", import.meta.url)),
	"utf8",
);

/** Every exported icon component paired with the viewBox it renders. */
function iconViewBoxes() {
	const components = Array.from(
		source.matchAll(
			/export const (\w+): React\.FC<React\.SVGProps<SVGSVGElement>>/g,
		),
	);
	return components.map((match, index) => {
		const start = match.index;
		const end = components[index + 1]?.index ?? source.length;
		const viewBox = /viewBox="([^"]+)"/.exec(source.slice(start, end))?.[1];
		const [, , width, height] = (viewBox ?? "")
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		return { name: match[1], width, height };
	});
}

describe("iconAspectRatios", () => {
	it("covers every mark whose viewBox is not square", () => {
		const missing = iconViewBoxes()
			.filter(({ name, width, height }) => {
				const aspect = width / height;
				if (!width || !height || Math.abs(aspect - 1) <= 0.02) {
					return false;
				}
				const component = (icons as Record<string, unknown>)[name];
				return !icons.iconAspectRatios.has(
					component as React.FC<React.SVGProps<SVGSVGElement>>,
				);
			})
			.map(({ name }) => name);

		expect(missing).toEqual([]);
	});

	it("matches the viewBox of each mark it lists", () => {
		const byName = new Map(
			iconViewBoxes().map(({ name, width, height }) => [name, width / height]),
		);
		const mismatched = Array.from(icons.iconAspectRatios.entries())
			.map(([component, aspect]) => {
				const name = Object.keys(icons).find(
					(key) => (icons as Record<string, unknown>)[key] === component,
				);
				const actual = name ? byName.get(name) : undefined;
				return { name, aspect, actual };
			})
			.filter(
				({ aspect, actual }) =>
					actual === undefined || Math.abs(actual - aspect) > 0.001,
			);

		expect(mismatched).toEqual([]);
	});
});

describe("ogIconSize", () => {
	it("letterboxes a wide mark inside the box", () => {
		expect(icons.ogIconSize(icons.XAIIcon, 68)).toEqual({
			width: 68,
			height: 26,
		});
	});

	it("pillarboxes a tall mark inside the box", () => {
		expect(icons.ogIconSize(icons.DeepInfraIcon, 32)).toEqual({
			width: 28,
			height: 32,
		});
	});

	it("leaves a square mark at the full box", () => {
		expect(icons.ogIconSize(icons.OpenAIIcon, 56)).toEqual({
			width: 56,
			height: 56,
		});
	});
});
