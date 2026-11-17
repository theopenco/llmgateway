import { describe, expect, it } from "vitest";

import { checkMessageFiles, isFileTypeAllowed } from "./files.js";

import type { Message } from "@/types.js";

const png = "data:image/png;base64," + "A".repeat(400);
const pdf = "data:application/pdf;base64," + "A".repeat(400);

const images = ["image/jpeg", "image/png", "image/gif", "image/webp"];

describe("isFileTypeAllowed", () => {
	it("matches MIME types, wildcards and extensions", () => {
		expect(isFileTypeAllowed("image/png", ["image/png"])).toBe(true);
		expect(isFileTypeAllowed("image/heic", ["image/*"])).toBe(true);
		expect(isFileTypeAllowed("application/pdf", ["pdf"])).toBe(true);
		expect(isFileTypeAllowed("application/pdf", [".PDF"])).toBe(true);
		expect(isFileTypeAllowed("application/pdf", ["image/*"])).toBe(false);
	});

	it("allows every type when the list is empty", () => {
		expect(isFileTypeAllowed("application/zip", [])).toBe(true);
	});
});

describe("checkMessageFiles", () => {
	const message = (part: Message["content"]): Message[] => [
		{ role: "user", content: part },
	];

	it("checks image_url data URIs against the configured types", () => {
		const messages = message([{ type: "image_url", image_url: { url: pdf } }]);
		expect(
			checkMessageFiles(messages, {
				allowedFileTypes: images,
				maxFileSizeMb: 10,
			}),
		).toEqual(["Blocked file type: application/pdf"]);
		expect(
			checkMessageFiles(messages, {
				allowedFileTypes: [...images, "pdf"],
				maxFileSizeMb: 10,
			}),
		).toEqual([]);
	});

	it("checks file parts and data URIs in text", () => {
		expect(
			checkMessageFiles(
				message([
					{ type: "file", file: { filename: "a.pdf", file_data: pdf } },
				]),
				{ allowedFileTypes: images, maxFileSizeMb: 10 },
			),
		).toEqual(["Blocked file type: application/pdf"]);
		expect(
			checkMessageFiles(message(`see ${pdf}`), {
				allowedFileTypes: images,
				maxFileSizeMb: 10,
			}),
		).toEqual(["Blocked file type: application/pdf"]);
	});

	it("uses the URL extension for remote files", () => {
		const messages = message([
			{
				type: "image_url",
				image_url: { url: "https://example.com/a.pdf?x=1" },
			},
			{ type: "image_url", image_url: { url: "https://example.com/image" } },
		]);
		expect(
			checkMessageFiles(messages, {
				allowedFileTypes: images,
				maxFileSizeMb: 10,
			}),
		).toEqual(["Blocked file type: application/pdf"]);
	});

	it("enforces the size limit", () => {
		const big = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024);
		expect(
			checkMessageFiles(
				message([{ type: "image_url", image_url: { url: big } }]),
				{
					allowedFileTypes: images,
					maxFileSizeMb: 1,
				},
			),
		).toEqual(["File larger than 1 MB"]);
		expect(
			checkMessageFiles(
				message([{ type: "image_url", image_url: { url: png } }]),
				{
					allowedFileTypes: images,
					maxFileSizeMb: 1,
				},
			),
		).toEqual([]);
	});
});
