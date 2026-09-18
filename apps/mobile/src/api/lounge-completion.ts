import { z } from "zod";

import { client } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import { generateReply } from "@/api/reply";
import { mergeSources, readSources } from "@/api/sources";
import { readToolParts } from "@/api/tool-parts";
import { xhrStreamFetch } from "@/api/xhr-stream";

import type { ChatMessage } from "@/api/chat-messages";
import type { Message } from "@/api/completion";
import type { Reply } from "@/api/reply";
import type { ToolPart } from "@/api/tool-parts";
import type { paths } from "@/lib/api/v1";
import type { ChatSettings } from "@/lib/preferences";

type RequestBody =
	paths["/lounge/chat"]["post"]["requestBody"]["content"]["application/json"];
export type LoungeMessage = RequestBody["messages"][number];

export function loungeMessage(
	message: Pick<
		ChatMessage,
		"id" | "role" | "content" | "reasoning" | "attachments" | "tools"
	>,
): LoungeMessage {
	const parts: Record<string, unknown>[] = [];
	if (message.reasoning) {
		parts.push({ type: "reasoning", text: message.reasoning });
	}
	if (message.content) {
		parts.push({ type: "text", text: message.content });
	}
	for (const file of message.attachments) {
		parts.push({
			type: "file",
			mediaType: file.mediaType,
			filename: file.name,
			url: file.url,
		});
	}
	parts.push(...readToolParts(message.tools));
	if (!parts.length) {
		parts.push({ type: "text", text: "" });
	}
	return { id: message.id, role: message.role, parts };
}

function stringField(event: Record<string, unknown>, key: string) {
	if (typeof event[key] !== "string") {
		throw new Error("The model returned an invalid stream event.");
	}
	return event[key];
}

export class LoungeReplyStream {
	public reply: Reply;
	private newText: boolean;
	private newReasoning: boolean;
	public constructor(model: string, initial?: Reply) {
		this.reply = {
			model,
			content: initial?.content ?? "",
			reasoning: initial?.reasoning ?? "",
			sources: initial?.sources ?? [],
			tools: initial?.tools ?? [],
		};
		this.newText = !!initial?.content;
		this.newReasoning = !!initial?.reasoning;
	}
	public consume(payload: string): Reply {
		const event = z
			.object({ type: z.string() })
			.passthrough()
			.parse(JSON.parse(payload));
		const parts = this.reply.tools ?? [];
		const update = (part: ToolPart) => {
			this.reply = {
				...this.reply,
				tools: parts.some((item) => item.toolCallId === part.toolCallId)
					? parts.map((item) =>
							item.toolCallId === part.toolCallId ? part : item,
						)
					: [...parts, part],
			};
		};
		switch (event.type) {
			case "text-delta":
				this.reply = {
					...this.reply,
					content:
						this.reply.content +
						(this.newText ? "\n\n" : "") +
						stringField(event, "delta"),
				};
				this.newText = false;
				break;
			case "reasoning-delta":
				this.reply = {
					...this.reply,
					reasoning:
						this.reply.reasoning +
						(this.newReasoning ? "\n\n" : "") +
						stringField(event, "delta"),
				};
				this.newReasoning = false;
				break;
			case "source-url":
				this.reply = {
					...this.reply,
					sources: mergeSources(
						this.reply.sources,
						readSources(JSON.stringify([event])),
					),
				};
				break;
			case "tool-input-available":
			case "tool-input-error":
				update({
					type: "dynamic-tool",
					toolCallId: stringField(event, "toolCallId"),
					toolName: stringField(event, "toolName"),
					input: event.input,
					state:
						event.type === "tool-input-error"
							? "output-error"
							: "input-available",
					...(event.type === "tool-input-error" && {
						errorText: stringField(event, "errorText"),
					}),
					...(event.providerMetadata !== undefined && {
						callProviderMetadata: event.providerMetadata,
					}),
				});
				break;
			case "tool-approval-request": {
				const part = parts.find((item) => item.toolCallId === event.toolCallId);
				if (!part || part.state !== "input-available") {
					throw new Error(
						"The model returned an approval without a complete tool request.",
					);
				}
				update({
					...part,
					state: "approval-requested",
					approval: {
						id: stringField(event, "approvalId"),
						signature: stringField(event, "signature"),
					},
				});
				break;
			}
			case "error":
				throw new Error(stringField(event, "errorText"));
			case "abort":
				throw new Error("Response stopped.");
		}
		return this.reply;
	}
	public interrupt(error: Error) {
		this.reply = {
			...this.reply,
			toolContinuation: !!this.reply.tools?.length,
			content:
				this.reply.content || (this.reply.tools?.length ? "" : error.message),
			error,
			tools: this.reply.tools?.map((part) => {
				if (
					![
						"input-streaming",
						"input-available",
						"approval-requested",
					].includes(part.state)
				) {
					return part;
				}
				return {
					...part,
					state: "output-error",
					approval: undefined,
					errorText:
						"This request was interrupted before approval. Ask again to create a new request.",
				};
			}),
		};
		return this.reply;
	}
}

export async function generateLoungeReply({
	projectId,
	model,
	messages,
	settings,
	signal,
	onReply,
	initial,
	plainMessages,
}: {
	projectId: string;
	model: string;
	messages: LoungeMessage[];
	settings: ChatSettings;
	signal: AbortSignal;
	onReply: (reply: Reply) => void;
	initial?: Reply;
	plainMessages?: Message[];
}): Promise<Reply> {
	const stream = new LoungeReplyStream(model, initial);
	try {
		const connections = await client.GET("/connectors", { signal });
		if (!connections.data) {
			throw new Error(
				"Your connections could not be loaded. Please try again.",
			);
		}
		const connectors = connections.data.connectors
			.filter((entry) => entry.available && entry.connected && entry.enabled)
			.map((entry) => entry.id);
		if (
			!connectors.length &&
			plainMessages &&
			!messages.some((message) =>
				message.parts.some(
					(part) =>
						part.type === "dynamic-tool" ||
						String(part.type).startsWith("tool-"),
				),
			)
		) {
			return await generateReply({
				projectId,
				model,
				messages: plainMessages,
				settings,
				signal,
				onReply,
			});
		}
		const token = await ensureGatewayKey(projectId);
		await client.POST("/lounge/chat", {
			body: {
				model,
				messages,
				connectors,
				temperature: settings.temperature,
				maxTokens: settings.maxTokens,
				webSearch: settings.webSearch,
				...(settings.reasoningEffort !== "auto" && {
					reasoningEffort: settings.reasoningEffort,
				}),
			},
			headers: { "x-llmgateway-key": token },
			signal,
			parseAs: "text",
			fetch: xhrStreamFetch((payload) => onReply(stream.consume(payload))),
		});
		if (
			!stream.reply.content &&
			!stream.reply.reasoning &&
			!stream.reply.tools?.length
		) {
			throw new Error("The response ended before any content arrived.");
		}
		return stream.reply;
	} catch (cause) {
		return stream.interrupt(
			cause instanceof Error
				? cause
				: new Error("The response could not finish. Please try again."),
		);
	}
}
