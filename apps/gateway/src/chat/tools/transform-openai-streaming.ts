/**
 * Helper function to transform standard OpenAI streaming format
 */
export function transformOpenaiStreaming(data: any, usedModel: string): any {
	// Ensure the response has the required OpenAI format fields
	if (!data.id || !data.object) {
		const delta = data.delta
			? {
					...data.delta,
					role: data.delta.role || "assistant",
				}
			: {
					content: data.content || "",
					tool_calls: data.tool_calls || null,
					role: "assistant",
				};

		// Normalize reasoning field to reasoning_content for consistency
		if (delta.reasoning && !delta.reasoning_content) {
			delta.reasoning_content = delta.reasoning;
			delete delta.reasoning;
		}

		return {
			id: data.id || `chatcmpl-${Date.now()}`,
			object: "chat.completion.chunk",
			created: data.created || Math.floor(Date.now() / 1000),
			model: data.model || usedModel,
			choices: data.choices || [
				{
					index: 0,
					delta,
					finish_reason: data.finish_reason || null,
				},
			],
			usage: data.usage || null,
		};
	} else {
		// Even if the response has the correct format, ensure role is set in delta and object is correct for streaming
		return {
			...data,
			object: "chat.completion.chunk", // Force correct object type for streaming
			choices:
				data.choices?.map((choice: any) => {
					const delta = choice.delta
						? {
								...choice.delta,
								role: choice.delta.role || "assistant",
							}
						: choice.delta;

					// Normalize reasoning field to reasoning_content for consistency
					if (delta?.reasoning && !delta.reasoning_content) {
						delta.reasoning_content = delta.reasoning;
						delete delta.reasoning;
					}

					return {
						...choice,
						delta,
					};
				}) || data.choices,
		};
	}
}
