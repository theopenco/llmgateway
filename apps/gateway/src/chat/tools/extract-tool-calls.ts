import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import type { Provider } from "@llmgateway/models";

/**
 * Extracts tool calls from streaming data based on provider format
 */
export function extractToolCalls(data: any, provider: Provider): any[] | null {
	switch (provider) {
		case "anthropic":
			// Anthropic streaming tool calls come as content_block_start with tool_use type
			if (
				data.type === "content_block_start" &&
				data.content_block?.type === "tool_use"
			) {
				return [
					{
						id: data.content_block.id,
						type: "function",
						function: {
							name: data.content_block.name,
							arguments: "",
						},
					},
				];
			}
			// Tool arguments come as content_block_delta - these don't have a direct ID,
			// so we return null and let the streaming logic handle the accumulation
			// by finding the matching tool call by content block index
			if (data.type === "content_block_delta" && data.delta?.partial_json) {
				// Return a partial tool call with the index to help with matching
				return [
					{
						_contentBlockIndex: data.index, // Use this for matching
						type: "function",
						function: {
							name: "",
							arguments: data.delta.partial_json,
						},
					},
				];
			}
			return null;
		case "google-ai-studio":
		case "google-vertex": {
			// Google AI Studio tool calls in streaming
			// Include thoughtSignature if present (required for Gemini 3 multi-turn conversations)
			const parts = data.candidates?.[0]?.content?.parts || [];
			return (
				parts
					.filter((part: any) => part.functionCall)
					.map((part: any, index: number) => {
						const toolCall: any = {
							id: part.functionCall.name + "_" + Date.now() + "_" + index,
							type: "function",
							function: {
								name: part.functionCall.name,
								arguments: JSON.stringify(part.functionCall.args || {}),
							},
						};
						// Include thoughtSignature in extra_content for client to pass back
						if (part.thoughtSignature) {
							toolCall.extra_content = {
								google: {
									thought_signature: part.thoughtSignature,
								},
							};
							// Cache thoughtSignature in Redis for server-side retrieval in multi-turn conversations
							// This is especially important when OpenAI SDKs don't preserve extra_content
							redisClient
								.setex(
									`thought_signature:${toolCall.id}`,
									86400, // 1 day expiration
									part.thoughtSignature,
								)
								.catch((err) => {
									logger.error(
										"Failed to cache thought_signature in streaming",
										{
											err,
										},
									);
								});
						}
						return toolCall;
					}) || null
			);
		}
		default: // OpenAI format
			return data.choices?.[0]?.delta?.tool_calls || null;
	}
}
