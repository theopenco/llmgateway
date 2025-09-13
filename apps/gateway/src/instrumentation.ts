import { initializeInstrumentation } from "@llmgateway/instrumentation";

// Initialize tracing for gateway service
initializeInstrumentation({
	serviceName: process.env.OTEL_SERVICE_NAME || "llmgateway-gateway",
	projectId: process.env.GOOGLE_CLOUD_PROJECT,
});
