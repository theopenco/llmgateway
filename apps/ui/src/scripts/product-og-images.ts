import { mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

/** Keep native image conversion in build/dev tooling, outside the OG route bundle. */
export async function generateProductOgImages(uiDir = process.cwd()) {
	const sourceDir = join(uiDir, "public/home/products");
	const outputDir = join(uiDir, "public/og-products");
	const screenshots = (await readdir(sourceDir)).filter((file) =>
		file.endsWith(".webp"),
	);
	await rm(outputDir, { recursive: true, force: true });
	await mkdir(outputDir, { recursive: true });
	for (const screenshot of screenshots) {
		const image = await sharp(join(sourceDir, screenshot)).png().toBuffer();
		await writeFile(
			join(outputDir, screenshot.replace(/\.webp$/, ".png")),
			image,
		);
	}
}
