export interface ResponsesContext {
	logId: string;
	syncInsert: boolean;
	responsesApiData: unknown;
}

const contextMap = new Map<string, ResponsesContext>();

export function setResponsesContext(
	key: string,
	context: ResponsesContext,
): void {
	contextMap.set(key, context);
}

export function getResponsesContext(key: string): ResponsesContext | undefined {
	const context = contextMap.get(key);
	if (context) {
		contextMap.delete(key);
	}
	return context;
}

export function deleteResponsesContext(key: string): void {
	contextMap.delete(key);
}
