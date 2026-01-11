import { createHttpClient } from "@llmgateway/shared";

export const httpClient = createHttpClient({
	tracerName: "llmgateway-gateway",
	clientName: "gateway-http-client",
});

export type { HttpClientOptions } from "@llmgateway/shared";
