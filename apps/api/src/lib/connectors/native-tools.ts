import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { shopDomain } from "./catalogue.js";
import { connectorFetch } from "./oauth.js";

import type { ConnectorCredentials } from "./oauth.js";
import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

const text = { type: "string" };
const limit = { type: "integer", minimum: 1, maximum: 50, default: 10 };
export const nativeTools = {
	gmail: [
		{
			name: "search_messages",
			description:
				"Search Gmail using Gmail search syntax. Returns message IDs; use read_message for contents.",
			inputSchema: {
				type: "object",
				properties: { query: text, limit },
				required: ["query"],
				additionalProperties: false,
			},
		},
		{
			name: "read_message",
			description: "Read a Gmail message by its ID.",
			inputSchema: {
				type: "object",
				properties: { id: text },
				required: ["id"],
				additionalProperties: false,
			},
		},
	],
	"google-drive": [
		{
			name: "search_files",
			description:
				"Find Google Drive files using Drive query syntax, for example name contains 'report'.",
			inputSchema: {
				type: "object",
				properties: { query: text, limit },
				required: ["query"],
				additionalProperties: false,
			},
		},
		{
			name: "read_document",
			description:
				"Export a Google Docs document as plain text using its file ID.",
			inputSchema: {
				type: "object",
				properties: { id: text },
				required: ["id"],
				additionalProperties: false,
			},
		},
	],
	shopify: [
		{
			name: "search_products",
			description: "Search store products using Shopify product search syntax.",
			inputSchema: {
				type: "object",
				properties: { query: text, limit },
				required: ["query"],
				additionalProperties: false,
			},
		},
		{
			name: "search_orders",
			description:
				"Search recent store orders using Shopify order search syntax.",
			inputSchema: {
				type: "object",
				properties: { query: text, limit },
				required: ["query"],
				additionalProperties: false,
			},
		},
	],
};

const search = z
	.object({
		query: z.string().max(2000),
		limit: z.number().int().min(1).max(50).default(10),
	})
	.strict();
const read = z
	.object({
		id: z
			.string()
			.regex(/^[a-zA-Z0-9_-]+$/)
			.max(256),
	})
	.strict();

function toolInput<T>(
	schema: z.ZodType<T, z.ZodTypeDef, unknown>,
	input: unknown,
): T {
	const result = schema.safeParse(input);
	if (!result.success) {
		throw new HTTPException(400, {
			message: "Invalid connector tool arguments",
		});
	}
	return result.data;
}

function gmailText(value: unknown, depth = 0): string[] {
	if (depth > 10 || typeof value !== "object" || value === null) {
		return [];
	}
	const part = value as Record<string, unknown>;
	if (part.mimeType === "text/plain" || part.mimeType === "text/html") {
		const body = part.body;
		if (
			typeof body === "object" &&
			body !== null &&
			"data" in body &&
			typeof body.data === "string"
		) {
			return [Buffer.from(body.data, "base64url").toString("utf8")];
		}
	}
	return Array.isArray(part.parts)
		? part.parts.flatMap((child: unknown) => gmailText(child, depth + 1))
		: [];
}

export async function executeNativeTool(
	id: LoungeConnectorId,
	name: string,
	input: unknown,
	credentials: ConnectorCredentials,
): Promise<unknown> {
	const token = credentials.tokens?.access_token;
	if (!token) {
		throw new HTTPException(409, { message: "Reconnect this connector" });
	}
	let url: URL;
	let body: string | undefined;
	let plainText = false;
	const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
	if (id === "gmail" && name === "search_messages") {
		const args = toolInput(search, input);
		url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
		url.search = new URLSearchParams({
			q: args.query,
			maxResults: String(args.limit),
		}).toString();
	} else if (id === "gmail" && name === "read_message") {
		url = new URL(
			`https://gmail.googleapis.com/gmail/v1/users/me/messages/${toolInput(read, input).id}?format=full`,
		);
	} else if (id === "google-drive" && name === "search_files") {
		const args = toolInput(search, input);
		url = new URL("https://www.googleapis.com/drive/v3/files");
		url.search = new URLSearchParams({
			q: `trashed = false and (${args.query})`,
			pageSize: String(args.limit),
			fields: "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime)",
			supportsAllDrives: "true",
			includeItemsFromAllDrives: "true",
		}).toString();
	} else if (id === "google-drive" && name === "read_document") {
		url = new URL(
			`https://www.googleapis.com/drive/v3/files/${toolInput(read, input).id}/export?mimeType=text%2Fplain`,
		);
		plainText = true;
	} else if (
		id === "shopify" &&
		(name === "search_products" || name === "search_orders")
	) {
		const args = toolInput(search, input);
		url = new URL(
			`https://${shopDomain(credentials.shop ?? "")}/admin/api/2026-07/graphql.json`,
		);
		delete headers.Authorization;
		headers["X-Shopify-Access-Token"] = token;
		headers["Content-Type"] = "application/json";
		const selection =
			name === "search_products"
				? "products(first: $limit, query: $query) { nodes { id title handle status description } pageInfo { hasNextPage endCursor } }"
				: "orders(first: $limit, query: $query) { nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } }";
		body = JSON.stringify({
			query: `query($limit: Int!, $query: String!) { ${selection} }`,
			variables: args,
		});
	} else {
		throw new HTTPException(400, { message: "Unknown connector tool" });
	}
	const response = await connectorFetch(url, {
		method: body ? "POST" : "GET",
		headers,
		body,
	});
	if (!response.ok) {
		throw new HTTPException(response.status === 401 ? 409 : 502, {
			message:
				response.status === 401
					? "Reconnect this connector"
					: "The connector could not complete this request",
		});
	}
	const content = await response.text();
	if (content.length > 1_000_000) {
		throw new HTTPException(413, {
			message: "The result is too large. Narrow your request.",
		});
	}
	if (plainText) {
		return { text: content };
	}
	const result: unknown = JSON.parse(content);
	if (
		id === "shopify" &&
		typeof result === "object" &&
		result !== null &&
		"errors" in result
	) {
		throw new HTTPException(502, {
			message: "The store could not complete this query",
		});
	}
	if (
		id === "gmail" &&
		name === "read_message" &&
		typeof result === "object" &&
		result !== null &&
		"payload" in result
	) {
		const message = result as Record<string, unknown>;
		const payload = z.record(z.unknown()).parse(message.payload);
		return {
			id: message.id,
			threadId: message.threadId,
			snippet: message.snippet,
			headers: payload.headers,
			text: gmailText(payload).join("\n\n"),
		};
	}
	return result;
}
