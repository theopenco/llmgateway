import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — MCP server for 200+ models";

export default function Image() {
	return ogImage({
		eyebrow: "MCP",
		title: "MCP Server for 200+ Models",
		subtitle:
			"Plug every model into Claude Code, Cursor, and any MCP client through one gateway.",
	});
}
