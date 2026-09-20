import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

async function pngOf(width: number, height: number) {
	return await sharp({
		create: { width, height, channels: 3, background: "#3366ff" },
	})
		.png()
		.toBuffer();
}

async function dimensionsOf(res: Response) {
	const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
	return { width: meta.width, height: meta.height };
}

describe("playground image history binary routes", () => {
	let authCookie: string;
	let itemId: string;
	let original: Buffer;

	const get = (path: string) =>
		app.request(`/playground/image-history/${itemId}${path}`, {
			headers: { Cookie: authCookie },
		});

	beforeEach(async () => {
		authCookie = await createTestUser();
		original = await pngOf(1600, 900);
		const input = await pngOf(64, 64);
		const res = await app.request("/playground/image-history", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: authCookie },
			body: JSON.stringify({
				prompt: "A blue rectangle",
				inputImages: [
					{
						dataUrl: `data:image/png;base64,${input.toString("base64")}`,
						mediaType: "image/png",
					},
				],
				models: [
					{
						modelId: "gemini-3-pro-image",
						modelName: "Gemini 3 Pro Image",
						images: [
							{ base64: original.toString("base64"), mediaType: "image/png" },
						],
					},
				],
			}),
		});
		expect(res.status).toBe(201);
		const json = await res.json();
		itemId = json.item.id;
		expect(json.item.inputImageCount).toBe(1);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("lists counts without image payloads", async () => {
		const res = await app.request("/playground/image-history", {
			headers: { Cookie: authCookie },
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.items[0]).toMatchObject({
			id: itemId,
			inputImageCount: 1,
			models: [{ modelId: "gemini-3-pro-image", imageCount: 1 }],
		});
		expect(JSON.stringify(json)).not.toContain(
			original.toString("base64").slice(0, 64),
		);
	});

	test("serves downscaled webp thumbnails and previews", async () => {
		const thumbnail = await get("/thumbnail");
		expect(thumbnail.status).toBe(200);
		expect(thumbnail.headers.get("content-type")).toBe("image/webp");
		expect(thumbnail.headers.get("cache-control")).toContain("immutable");
		expect(await dimensionsOf(thumbnail)).toEqual({ width: 128, height: 72 });

		const preview = await get("/images/0/0?variant=preview");
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-type")).toBe("image/webp");
		expect(await dimensionsOf(preview)).toEqual({ width: 1024, height: 576 });
	});

	test("serves the original bytes for the full variant", async () => {
		const res = await get("/images/0/0");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(Buffer.from(await res.arrayBuffer()).equals(original)).toBe(true);
	});

	test("serves attached input images without enlarging them", async () => {
		const res = await get("/input-images/0?variant=thumbnail");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/webp");
		expect(await dimensionsOf(res)).toEqual({ width: 64, height: 64 });
	});

	test("rejects unknown indexes and variants", async () => {
		expect((await get("/images/0/1")).status).toBe(404);
		expect((await get("/images/1/0")).status).toBe(404);
		expect((await get("/images/x/0")).status).toBe(400);
		expect((await get("/images/0/0?variant=huge")).status).toBe(400);
		expect((await get("/input-images/1")).status).toBe(404);
	});

	test("requires authentication", async () => {
		const res = await app.request(
			`/playground/image-history/${itemId}/images/0/0`,
		);
		expect(res.status).toBe(401);
	});
});
