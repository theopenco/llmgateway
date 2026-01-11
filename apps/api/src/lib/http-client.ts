import { createHttpClient } from "@llmgateway/shared";

export const httpClient = createHttpClient({
	tracerName: "llmgateway-api",
	clientName: "api-http-client",
});

export type { HttpClientOptions } from "@llmgateway/shared";
