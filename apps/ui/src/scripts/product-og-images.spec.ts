import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { generateProductOgImages } from "@/scripts/product-og-images";

const uiDir = resolve(import.meta.dirname, "../..");
const scratchDir = resolve(uiDir, "../../.context");
const temporaryDirs: string[] = [];

async function fixtureDir() {
	await mkdir(scratchDir, { recursive: true });
	const dir = await mkdtemp(join(scratchDir, "product-og-"));
	temporaryDirs.push(dir);
	await mkdir(join(dir, "public/home/products"), { recursive: true });
	return dir;
}

afterEach(async () => {
	for (const dir of temporaryDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("generateProductOgImages", () => {
	it("preserves PNG bytes, dimensions and pixels for every product screenshot", async () => {
		const dir = await fixtureDir();
		const sourceDir = join(uiDir, "public/home/products");
		const screenshots = (await readdir(sourceDir)).filter((file) =>
			file.endsWith(".webp"),
		);
		expect(screenshots.length).toBeGreaterThan(0);
		for (const screenshot of screenshots) {
			await writeFile(
				join(dir, "public/home/products", screenshot),
				await readFile(join(sourceDir, screenshot)),
			);
		}
		await generateProductOgImages(dir);
		expect((await readdir(join(dir, "public/og-products"))).sort()).toEqual(
			screenshots.map((file) => file.replace(/\.webp$/, ".png")).sort(),
		);
		for (const screenshot of screenshots) {
			const expected = await sharp(join(sourceDir, screenshot))
				.png()
				.toBuffer();
			const actual = await readFile(
				join(dir, "public/og-products", screenshot.replace(/\.webp$/, ".png")),
			);
			expect(actual.equals(expected), screenshot).toBe(true);
			expect(await sharp(actual).metadata()).toEqual(
				await sharp(expected).metadata(),
			);
			const actualPixels = await sharp(actual).raw().toBuffer();
			const expectedPixels = await sharp(expected).raw().toBuffer();
			expect(actualPixels.equals(expectedPixels), screenshot).toBe(true);
		}
	}, 60_000);

	it("overwrites generated images when the source changes and ignores other files", async () => {
		const dir = await fixtureDir();
		const source = join(dir, "public/home/products/screenshot.webp");
		const output = join(dir, "public/og-products/screenshot.png");
		await writeFile(
			join(dir, "public/home/products/notes.txt"),
			"not an image",
		);
		for (const background of ["red", "blue"]) {
			await sharp({ create: { width: 3, height: 2, channels: 3, background } })
				.webp()
				.toFile(source);
			await generateProductOgImages(dir);
			expect(
				(await readFile(output)).equals(await sharp(source).png().toBuffer()),
			).toBe(true);
		}
		expect(await readdir(join(dir, "public/og-products"))).toEqual([
			"screenshot.png",
		]);
	});

	it("removes derivatives when their source screenshots disappear", async () => {
		const dir = await fixtureDir();
		const source = join(dir, "public/home/products/screenshot.webp");
		await sharp({
			create: { width: 1, height: 1, channels: 3, background: "red" },
		})
			.webp()
			.toFile(source);
		await generateProductOgImages(dir);
		await rm(source);
		await generateProductOgImages(dir);
		expect(await readdir(join(dir, "public/og-products"))).toEqual([]);
	});

	it("rejects invalid screenshots instead of silently skipping conversion", async () => {
		const dir = await fixtureDir();
		await writeFile(join(dir, "public/home/products/broken.webp"), "invalid");
		await expect(generateProductOgImages(dir)).rejects.toThrow();
	});
});
