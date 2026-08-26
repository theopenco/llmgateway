# @llmgateway/benchmarks

Reusable model and provider-mapping benchmarks for one-off CLI runs and scheduled jobs.

## Programmatic use

```ts
import {
  getBuiltInSuite,
  resolveBenchmarkTargets,
  runBenchmark,
} from "@llmgateway/benchmarks";

const targets = resolveBenchmarkTargets({
  modelIds: [modelId],
  mappings: selectedMappings,
});

const result = await runBenchmark({
  client: { url, apiKey },
  targets,
  cases: getBuiltInSuite("core"),
  referenceTargetId: targets[0].id,
});
```

`runBenchmark` returns a JSON-serializable result containing configuration, targets, case descriptors, raw trials, timing and usage data, validation results, summaries, and reference-answer agreement. Callers can inject custom cases, `fetch`, concurrency, request overrides, and progress handling.

## CLI

```bash
pnpm benchmark -- --model <model-id> --mapping <provider> --mapping <provider:region>
pnpm benchmark -- --model <model-id> --suite performance --runs 10
pnpm benchmark -- --model <model-id> --format markdown --output benchmark.md
pnpm benchmark -- --model <model-id> --format html --output benchmark.html
```

JSON is written to stdout by default. Progress goes to stderr, so the output can be piped into another program. Use `--quiet` for no progress output and `--no-responses` when a background job should omit generated text.

Each request has a 60-second timeout by default. Override it programmatically with `timeoutMs` or from the CLI with `--timeout <milliseconds>`.

Run `pnpm benchmark -- --help` for all options. Mapping selectors accept a provider, an exact `provider:region`, `provider:*` for every concrete region, or `*` for every active mapping.
