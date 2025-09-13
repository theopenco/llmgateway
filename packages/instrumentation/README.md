# LLMGateway Instrumentation Package

This package provides OpenTelemetry instrumentation and tracing middleware for LLMGateway services.

## Features

- OpenTelemetry integration with Google Cloud Trace
- Sampling rate configuration via `OTEL_SAMPLE_RATE` environment variable
- **Force tracing via HTTP header** - Use `X-Force-Trace: true` or `X-Force-Trace: 1` to force trace collection regardless of sampling rate
- Hono middleware for automatic request tracing

## Usage

### Initialization

```typescript
import { initializeInstrumentation } from "@llmgateway/instrumentation";

initializeInstrumentation({
  serviceName: "my-service",
  projectId: "my-gcp-project",
});
```

### Middleware

```typescript
import { Hono } from "hono";
import { createTracingMiddleware } from "@llmgateway/instrumentation";

const app = new Hono();
app.use("*", createTracingMiddleware({ serviceName: "my-service" }));
```

### Force Tracing

To force a request to be traced regardless of the configured sampling rate, include the `X-Force-Trace` header in your HTTP request:

```bash
# Force tracing with value 'true'
curl -H "X-Force-Trace: true" http://localhost:4001/v1/chat/completions

# Force tracing with value '1'
curl -H "X-Force-Trace: 1" http://localhost:4001/v1/chat/completions
```

The force tracing feature:

- Works with any sampling rate (0% to 100%)
- Adds a `sampling.forced: true` attribute to forced traces for easy identification
- Only activates when header value is exactly `"true"` or `"1"`

## Environment Variables

- `OTEL_SAMPLE_RATE`: Sampling rate from 0.0 to 1.0 (default: undefined = 100% sampling)
- `GOOGLE_CLOUD_PROJECT`: GCP project ID for trace export
- `OTEL_SERVICE_NAME`: Override service name

## Architecture

The package uses a custom `HeaderBasedForceSampler` that wraps the configured base sampler (AlwaysOnSampler or TraceIdRatioBasedSampler). When a request includes the force-trace header, the middleware captures it as a span attribute, and the sampler checks for this attribute to make the sampling decision.
