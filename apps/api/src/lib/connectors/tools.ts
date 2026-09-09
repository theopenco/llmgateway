import { createMCPClient } from "@ai-sdk/mcp";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HTTPException } from "hono/http-exception";

import { and, db, eq, tables } from "@llmgateway/db";

import { mcpEndpoints, nativeOAuth } from "./catalogue.js";
import { openConnector, sealConnector } from "./crypto.js";
import { executeNativeTool, nativeTools } from "./native-tools.js";
import {
	connectorFetch,
	credentialsSchema,
	exchangeNativeToken,
	mcpOAuthProvider,
} from "./oauth.js";

import type { MCPClient } from "@ai-sdk/mcp";
import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

export interface ConnectorTool {
	connectorId: LoungeConnectorId;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

async function refreshConnection(userId: string, id: LoungeConnectorId) {
	return await db.transaction(async (tx) => {
		// Only token refresh holds the row lock; tool calls run outside it.
		const [connection] = await tx
			.select()
			.from(tables.loungeConnection)
			.where(
				and(
					eq(tables.loungeConnection.userId, userId),
					eq(tables.loungeConnection.connectorId, id),
					eq(tables.loungeConnection.enabled, true),
				),
			)
			.for("update");
		if (!connection) {
			throw new HTTPException(409, {
				message: "This connector is disconnected or paused",
			});
		}
		const credentials = credentialsSchema.parse(
			openConnector(connection.credentials, userId, id),
		);
		if (
			!credentials.expiresAt ||
			credentials.expiresAt >= Date.now() + 60_000
		) {
			return connection;
		}
		if (nativeOAuth(id, credentials.shop)) {
			await exchangeNativeToken(id, credentials);
		} else {
			const endpoint = mcpEndpoints[id];
			if (!endpoint) {
				throw new HTTPException(409, { message: "Reconnect this connector" });
			}
			await auth(
				mcpOAuthProvider(
					id,
					credentials,
					async () => {},
					() => {
						throw new HTTPException(409, {
							message: "Reconnect this connector",
						});
					},
				),
				{ serverUrl: endpoint, fetchFn: connectorFetch },
			);
		}
		const [updated] = await tx
			.update(tables.loungeConnection)
			.set({
				credentials: sealConnector(credentials, userId, id),
				updatedAt: new Date(),
			})
			.where(eq(tables.loungeConnection.id, connection.id))
			.returning();
		return updated;
	});
}

async function withConnection<T>(
	userId: string,
	id: LoungeConnectorId,
	run: (context: {
		client?: MCPClient;
		executeNative: (name: string, input: unknown) => Promise<unknown>;
	}) => Promise<T>,
): Promise<T> {
	let connection = await db.query.loungeConnection.findFirst({
		where: { userId, connectorId: id, enabled: true },
	});
	if (!connection) {
		throw new HTTPException(409, {
			message: "This connector is disconnected or paused",
		});
	}
	let credentials = credentialsSchema.parse(
		openConnector(connection.credentials, userId, id),
	);
	if (credentials.expiresAt && credentials.expiresAt < Date.now() + 60_000) {
		connection = await refreshConnection(userId, id);
		credentials = credentialsSchema.parse(
			openConnector(connection.credentials, userId, id),
		);
	}
	const connectionId = connection.id;
	let stored = connection.credentials;
	const persist = async () => {
		const encrypted = sealConnector(credentials, userId, id);
		const rows = await db
			.update(tables.loungeConnection)
			.set({ credentials: encrypted })
			.where(
				and(
					eq(tables.loungeConnection.id, connectionId),
					eq(tables.loungeConnection.userId, userId),
					eq(tables.loungeConnection.credentials, stored),
					eq(tables.loungeConnection.enabled, true),
				),
			)
			.returning({ id: tables.loungeConnection.id });
		if (!rows.length) {
			throw new HTTPException(409, {
				message: "The connector changed. Try your request again.",
			});
		}
		stored = encrypted;
	};
	const executeNative = async (name: string, input: unknown) =>
		await executeNativeTool(id, name, input, credentials);
	const endpoint = mcpEndpoints[id];
	if (!endpoint) {
		return await run({ executeNative });
	}
	const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
		fetch: connectorFetch,
		...(id === "github"
			? {
					requestInit: {
						headers: {
							Authorization: `Bearer ${credentials.tokens?.access_token}`,
						},
					},
				}
			: {
					authProvider: mcpOAuthProvider(id, credentials, persist, () => {
						throw new HTTPException(409, {
							message: "Reconnect this connector",
						});
					}),
				}),
	});
	let client: MCPClient | undefined;
	try {
		client = await createMCPClient({ transport });
		return await run({ client, executeNative });
	} finally {
		await transport.close();
		if (client) {
			await client.close();
		}
	}
}

export async function listConnectorTools(
	userId: string,
	ids: LoungeConnectorId[],
): Promise<ConnectorTool[]> {
	const tools: ConnectorTool[] = [];
	for (const id of ids) {
		await withConnection(userId, id, async ({ client }) => {
			if (client) {
				let cursor: string | undefined;
				const cursors = new Set<string>();
				do {
					const result = await client.listTools({
						params: cursor ? { cursor } : undefined,
					});
					for (const definition of result.tools) {
						if (!/^[a-zA-Z0-9_-]{1,48}$/.test(definition.name)) {
							continue;
						}
						tools.push({
							connectorId: id,
							name: definition.name,
							description: definition.description ?? definition.name,
							inputSchema: definition.inputSchema,
						});
					}
					cursor = result.nextCursor;
					if (cursor) {
						if (cursors.has(cursor) || cursors.size >= 20) {
							throw new HTTPException(502, {
								message: "The connector returned too many tool pages",
							});
						}
						cursors.add(cursor);
					}
					if (tools.length > 500) {
						throw new HTTPException(502, {
							message: "Too many connector tools. Select fewer connectors.",
						});
					}
				} while (cursor);
			} else if (id in nativeTools) {
				const definitions = nativeTools[id as keyof typeof nativeTools];
				tools.push(
					...definitions.map((definition) => ({
						connectorId: id,
						...definition,
					})),
				);
			}
		});
	}
	return tools;
}

export async function callConnectorTool(
	userId: string,
	id: LoungeConnectorId,
	name: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	return await withConnection(userId, id, async ({ client, executeNative }) => {
		if (!client) {
			return await executeNative(name, input);
		}
		return await client.callTool({
			name,
			arguments: input,
			options: { timeout: 60_000 },
		});
	});
}
