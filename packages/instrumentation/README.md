# LLMGateway Instrumentation Package

This package provides OpenTelemetry instrumentation and tracing middleware for LLMGateway services.

## Features

- OpenTelemetry integration with Google Cloud Trace
- Sampling rate configuration via `OTEL_SAMPLE_RATE` environment variable
- **Error-aware sampling** - Configure different sampling rates for error spans using `OTEL_ERROR_SAMPLE_RATE`
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

### Error-Aware Sampling

Configure different sampling rates for error spans vs normal spans:

```bash
# Sample 10% of normal requests, but 100% of error requests
export OTEL_SAMPLE_RATE=0.1
export OTEL_ERROR_SAMPLE_RATE=1.0

# Start your service
npm start
```

The error-aware sampling works by:

1. **Heuristic Detection**: Identifies likely error spans based on:
   - HTTP status codes ≥ 400
   - Error-related span names (containing "error", "exception", "fail", "timeout", "abort")
   - Custom `sampling.likely_error` attribute set by middleware

2. **Differential Sampling**: Applies different sampling rates:
   - Normal spans: Uses `OTEL_SAMPLE_RATE`
   - Error spans: Uses `OTEL_ERROR_SAMPLE_RATE`

3. **Sampling Metadata**: Adds `sampling.strategy` attribute indicating which strategy was used

## Environment Variables

- `OTEL_SAMPLE_RATE`: Sampling rate for normal spans from 0.0 to 1.0 (default: undefined = 100% sampling)
- `OTEL_ERROR_SAMPLE_RATE`: Sampling rate for error spans from 0.0 to 1.0 (default: same as `OTEL_SAMPLE_RATE`)
- `GOOGLE_CLOUD_PROJECT`: GCP project ID for trace export
- `OTEL_SERVICE_NAME`: Override service name

## Architecture

The package uses a layered sampler architecture:

1. **ErrorAwareSampler**: Applies different sampling rates based on error detection heuristics
2. **HeaderBasedForceSampler**: Wraps the error-aware sampler to handle force-trace headers
3. **Base Samplers**: AlwaysOnSampler or TraceIdRatioBasedSampler for actual sampling decisions

When a request includes the force-trace header, the middleware captures it as a span attribute, and the sampler checks for this attribute to make the sampling decision. For error-aware sampling, the system uses heuristics at sampling time to identify likely error spans and applies the appropriate sampling rate.
