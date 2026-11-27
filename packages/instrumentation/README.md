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

When the rates differ, spans are recorded at the higher rate and filtered after they end. HTTP status codes of 400 or higher and OpenTelemetry error status use `OTEL_ERROR_SAMPLE_RATE`; other spans use `OTEL_SAMPLE_RATE`. Forced spans are always exported. Span names and user agents do not classify failures.

Selection applies to individual completed spans, not entire traces. Successful child spans can be omitted from an error trace. Recording and propagated sampling flags use the higher rate, so a lower export rate does not reduce recording overhead to the same level. Recorded spans carry `sampling.strategy: final-status`.

## Environment Variables

- `OTEL_SAMPLE_RATE`: Sampling rate for normal spans from 0.0 to 1.0 (default: undefined = 100% sampling)
- `OTEL_ERROR_SAMPLE_RATE`: Sampling rate for error spans from 0.0 to 1.0 (default: same as `OTEL_SAMPLE_RATE`)
- `GOOGLE_CLOUD_PROJECT`: GCP project ID for trace export
- `OTEL_SERVICE_NAME`: Override service name

## Architecture

`HeaderBasedForceSampler` honors explicit force tracing. With different normal and error rates, `ErrorAwareSampler` records the union of both ratio decisions, then `FinalStatusSpanProcessor` filters completed spans before the batch exporter. With equal rates, the ordinary head sampler sends selected spans directly to the batch exporter.
