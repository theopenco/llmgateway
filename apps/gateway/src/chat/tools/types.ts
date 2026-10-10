import type { ReasoningDetail } from "@llmgateway/models";

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
		/** Publication date (YYYY-MM-DD), when the upstream reports one. */
		date?: string;
		/** Last-updated date (YYYY-MM-DD), when the upstream reports one. */
		last_updated?: string;
	};
}

export type Annotation = UrlCitationAnnotation;

/**
 * Top-level `search_results` entry. Perplexity returns these alongside the
 * answer and callers read the dates off them, so they are re-emitted verbatim
 * rather than flattened into annotations alone.
 */
export interface SearchResult {
	title?: string;
	url: string;
	snippet?: string;
	date?: string;
	last_updated?: string;
	source?: string;
}

// Define streaming delta object type
export interface StreamingDelta {
	role?: "assistant";
	content?: string;
	reasoning?: string;
	reasoning_details?: ReasoningDetail[];
	images?: ImageObject[];
	tool_calls?: ToolCall[];
	annotations?: Annotation[];
}
