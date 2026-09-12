---
name: model-benchmarks
description: Run and report repository model or provider-mapping benchmarks. Use when asked to benchmark a model, compare all mappings or regions, collect latency or throughput metrics, run the smoke, standard, load, capability, quality, or performance suites, or inspect an existing benchmark JSON result.
---

# Model benchmarks

Run paid benchmarks only when the user explicitly asks. Use the wrapper so raw
results survive and failed evaluations still retain their timing data:

```bash
node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> [benchmark options]
```

The wrapper builds `@llmgateway/benchmarks`, creates an absolute output path,
and writes results under `.context/benchmarks`. It defaults to every active
mapping, the `smoke` profile, and a 120-second per-target budget. Override those
defaults with ordinary CLI options, for example:

```bash
node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> \
  --mapping <provider> --profile load --budget 300000
```

Do not pass `--output` or `--format`; the wrapper owns them. Set
`BENCHMARK_OUTPUT_DIR` when results belong elsewhere. The benchmark CLI reads
`LLM_GATEWAY_API_KEY`, falls back to `LLMGATEWAY_API_KEY`, and loads the root
`.env` file.

A budget is a maximum per target, not total run time. A request already in
flight may finish after its target reaches the budget. Keep cache and fallback
disabled unless the user explicitly asks otherwise, so results stay pinned to
the selected mapping.

The wrapper preserves:

- `.json`: raw trials, responses, usage, cost, and stream events.
- `.md` and `.html`: built-in benchmark reports.
- `-timings.md`: timings grouped by target and case, including evaluator
  failures.
- `-timings.csv`: every trial's timing and usage fields.

If rendering fails after JSON is saved, render it without rerunning paid
requests:

```bash
node .agents/skills/model-benchmarks/scripts/render-results.mjs <absolute-json-path>
```

If a run makes requests but saves no JSON, report the loss and ask before
rerunning. After completion, link the reports and summarize quality,
reliability, TTFT, total latency, throughput, buffering, truncation, cost, and
provider errors.
