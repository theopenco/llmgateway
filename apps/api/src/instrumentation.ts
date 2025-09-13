import { initializeInstrumentation } from "@llmgateway/instrumentation";

// Initialize tracing for API service
initializeInstrumentation({
	serviceName: process.env.OTEL_SERVICE_NAME || "llmgateway-api",
	projectId: process.env.GOOGLE_CLOUD_PROJECT,
});
