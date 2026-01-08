export const DEFAULT_TOKENIZER_MODEL = "gpt-4";

// Define ChatMessage type to match what gpt-tokenizer expects
export interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

// Define OpenAI-compatible image object type
export interface ImageObject {
	type: "image_url";
	image_url: {
		url: string;
	};
}

// Define tool call object type
export interface ToolCall {
	id: string;
	type: "function";
	index: number;
	function: {
		name: string;
		arguments: string;
	};
}

// Define URL citation annotation type (for web search results)
export interface UrlCitationAnnotation {
	type: "url_citation";
	url_citation: {
		url: string;
		title?: string;
		start_index?: number;
		end_index?: number;
	};
}

export type Annotation = UrlCitationAnnotation;

// Define streaming delta object type
export interface StreamingDelta {
	role?: "assistant";
	content?: string;
	reasoning?: string;
	images?: ImageObject[];
	tool_calls?: ToolCall[];
	annotations?: Annotation[];
}
