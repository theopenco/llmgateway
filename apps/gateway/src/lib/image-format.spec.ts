import { describe, expect, it } from "vitest";

import { imageFormatFromBase64, imageMimeType } from "./image-format.js";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("imageFormatFromBase64", () => {
	it.each([
		["a bare root element", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
		["an XML declaration", '<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>'],
		["a byte order mark", '\uFEFF<svg viewBox="0 0 1 1"/>'],
		["leading whitespace", '\n\t  <svg viewBox="0 0 1 1"/>'],
		[
			"a comment and a doctype",
			'<?xml version="1.0"?><!-- Generator: x --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>',
		],
	])("detects SVG with %s", (_case, svg) => {
		expect(imageFormatFromBase64(b64(svg))).toBe("svg");
		expect(imageMimeType("svg")).toBe("image/svg+xml");
	});

	it.each([
		["other XML", '<?xml version="1.0"?><feed/>'],
		["an <svgx> element", "<svgx/>"],
		["plain text", "hello"],
	])("does not label %s as SVG", (_case, text) => {
		expect(imageFormatFromBase64(b64(text))).toBeUndefined();
	});
});
