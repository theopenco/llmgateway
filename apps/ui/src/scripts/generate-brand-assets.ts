import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
	logoLockupWidth,
	logoPaths,
	logoWordmarkPath,
} from "../../../../packages/shared/src/components/ui/logo-paths";

async function main() {
	for (const variant of ["black", "white"] as const) {
		for (const withName of [false, true]) {
			const name = `logo${withName ? "-with-name" : ""}-${variant}`;
			const width = withName ? logoLockupWidth : 218;
			const paths = withName ? [...logoPaths, logoWordmarkPath] : logoPaths;
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="232" viewBox="0 0 ${width} 232" fill="${variant === "black" ? "#000000" : "#ffffff"}">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>\n`;
			const destination = fileURLToPath(
				new URL(`../../public/brand/${name}`, import.meta.url),
			);
			await writeFile(`${destination}.svg`, svg);
			await sharp(Buffer.from(svg))
				.resize({ height: withName ? 312 : 1024 })
				.png()
				.toFile(`${destination}.png`);
		}
	}
}

void main();
