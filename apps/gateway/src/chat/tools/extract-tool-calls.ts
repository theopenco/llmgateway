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
			// Per OpenAI spec, subsequent chunks omit id/type/name - only index and arguments
			if (data.type === "content_block_delta" && data.delta?.partial_json) {
				// Return a partial tool call with the index to help with matching
				return [
					{
						_contentBlockIndex: data.index, // Use this for matching
						function: {
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
			// Note: Redis caching of thought_signature happens in transform-streaming-to-openai.ts
			// where the actual tool_call ID sent to clients is generated
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
						}
						return toolCall;
					}) || null
			);
		}
		case "aws-bedrock": {
			const eventType = data.__aws_event_type;
			// contentBlockStart has the tool id and name
			if (eventType === "contentBlockStart" && data.start?.toolUse) {
				return [
					{
						id: data.start.toolUse.toolUseId,
						type: "function",
						function: {
							name: data.start.toolUse.name,
							arguments: "",
						},
					},
				];
			}
			// contentBlockDelta has the partial JSON arguments
			// Per OpenAI spec, subsequent chunks omit id/type/name - only index and arguments
			if (eventType === "contentBlockDelta" && data.delta?.toolUse) {
				const args =
					typeof data.delta.toolUse.input === "string"
						? data.delta.toolUse.input
						: JSON.stringify(data.delta.toolUse.input || {});
				return [
					{
						_contentBlockIndex: data.contentBlockIndex ?? 0,
						function: {
							arguments: args,
						},
					},
				];
			}
			return null;
		}
		default: // OpenAI format
			return data.choices?.[0]?.delta?.tool_calls || null;
	}
}
