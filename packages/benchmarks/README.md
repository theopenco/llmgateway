# @llmgateway/benchmarks

Reusable model and provider-mapping benchmarks for one-off CLI runs and scheduled jobs. Results are JSON-serializable and include raw trials, seeded case parameters, quality and fingerprint summaries, stream telemetry, reliability, estimated cost, and load behavior.

## Programmatic use

```ts
import {
  getBuiltInProfile,
  resolveBenchmarkTargets,
  runBenchmark,
} from "@llmgateway/benchmarks";

const profile = getBuiltInProfile("smoke");
const targets = resolveBenchmarkTargets({
  modelIds: [modelId],
  mappings: selectedMappings,
});

const result = await runBenchmark({
  client: { url, apiKey },
  targets,
  cases: profile.cases,
  referenceTargetId: targets[0].id,
  ...profile.defaults,
});
```

`runBenchmark()` accepts custom cases, request overrides, a reproducible base seed, per-request timeout, per-target wall-clock budget, response retention, injected `fetch`, and progress callbacks. Cache and fallback are disabled by default so each target remains isolated.

The default request timeout and per-target benchmark budget are both 60 seconds, but they are independent. Set `budgetMs: null` to run every configured trial.

## Profiles

- `smoke`: generated reasoning, robustness, structured output, grounding, instruction hierarchy, tool use, and streaming under a 60-second per-target budget.
- `standard`: the full generated and fixed capability suite, reasoning-effort sweep, long context, calibration, multilingual behavior, and streaming.
- `load`: input/output-length and concurrency sweeps from 1 through 16.

Legacy `core`, `capability`, `quality`, `performance`, and `load` suites remain available through `getBuiltInSuite()` and `--suite`.

## CLI

```bash
pnpm benchmark -- --model <model-id> --mapping <provider> --profile smoke
pnpm benchmark -- --model <model-id> --profile standard --budget 300000
pnpm benchmark -- --model <model-id> --profile load --no-budget
pnpm benchmark -- --model <model-id> --format markdown --output benchmark.md
pnpm benchmark -- --model <model-id> --format html --output benchmark.html
```

JSON is written to stdout by default. Progress goes to stderr, so output can be piped into another program. Use `--quiet` for no progress and `--no-responses` to remove generated content, reasoning, tool calls, and chunk events from stored trials.

Run `pnpm benchmark -- --help` for all options. Mapping selectors accept a provider, exact `provider:region`, `provider:*` for every region, or `*` for every active mapping.

## Metrics

Quality is reported overall and by capability dimension, category, and difficulty. Repeated cases include first-pass accuracy, consistency, answer entropy, calibration, robustness drop, pairwise agreement, agreement on reference errors, rare-error agreement, and behavioral similarity with a bootstrap confidence interval.

Performance includes header, first-event, first-reasoning, first-content, generation, and total latency; visible throughput; stream stalls and burstiness; buffered-stream rate; warm-up trials; success, timeout, rate-limit, truncation, and malformed-stream rates; request throughput; concurrency degradation; reasoning-token ratio; and catalogue-price cost estimates. p95 is emitted only with at least 20 samples and p99 with at least 100.

## External suites and coding

External datasets stay optional. Implement `BenchmarkSuiteAdapter` and load it with `loadExternalSuite()` to integrate suites such as LiveBench, BFCL, or LongBench without adding them to the package dependency graph.

### IFEval example

The included `ifevalAdapter` loads the official [IFEval](https://github.com/google-research/google-research/tree/master/instruction_following_eval) JSONL dataset from a local path or URL. It reports strict prompt-level accuracy in `quality.score` and instruction-level accuracy in `quality.instructionScore`. `--external-mode loose` applies IFEval's relaxed response transformations.

This example pins the dataset revision so repeated runs use the same prompts:

```bash
pnpm benchmark -- \
  --model <model-id> \
  --external ifeval \
  --external-data https://raw.githubusercontent.com/google-research/google-research/807d4a2f41202059bac2446259d135a89ed3630a/instruction_following_eval/data/input_data.jsonl \
  --external-limit 25 \
  --no-budget \
  --format markdown \
  --output ifeval.md
```

The adapter implements the deterministic constraints that do not need IFEval's Python language detector or NLTK tokenizers. The pinned revision above provides 334 supported prompts out of 541. Prompts containing unsupported constraints are skipped as whole prompts so prompt-level scores remain meaningful. Use `--external-unsupported error` to audit dataset coverage instead. The Apache-2.0 IFEval source and dataset are not bundled.

Programmatic use follows the same adapter contract:

```ts
import {
  ifevalAdapter,
  loadExternalSuite,
  runBenchmark,
} from "@llmgateway/benchmarks";

const cases = await loadExternalSuite(ifevalAdapter, {
  source: datasetPath,
  limit: 25,
  mode: "strict",
});

const result = await runBenchmark({
  client: { url, apiKey },
  targets,
  cases,
  budgetMs: null,
});
```

Generated code is never executed in-process. `createSandboxedCodingCase()` accepts a caller-provided sandbox that compiles the TypeScript and runs hidden tests with its own isolation and timeout policy.
