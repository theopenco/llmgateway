import { createTracingMiddleware } from "@llmgateway/instrumentation";

export const tracingMiddleware = createTracingMiddleware({
	serviceName: "llmgateway-gateway",
});
