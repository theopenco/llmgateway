---
name: model-benchmarks
description: Run and report repository model or provider-mapping benchmarks. Use when asked to benchmark a model, compare all mappings or regions, collect latency or throughput metrics, measure agentic coding or multi-turn tool-calling performance, run the smoke, standard, coding, load, capability, quality, or performance suites, or inspect an existing benchmark JSON result.
---

# Model benchmarks

Run paid benchmarks only when the user explicitly asks. Use the wrapper so raw
results survive and failed evaluations still retain their timing data:

```bash
node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> [benchmark options]
```

The wrapper builds `@llmgateway/benchmarks`, creates an absolute output path,
and writes results under `.context/benchmarks`. It defaults to every active
mapping and the `smoke` profile. The per-target budget defaults per profile —
`smoke` 2 min, `load` 60 min, `standard` and `coding` 15 min, `--suite` or
`--external` 10 min — so slow providers finish the profile, and the request
timeout defaults to 5 min so long streams are not cut off as
`stream_read_error`. `standard` runs its
throughput case (`fixed_output_stream`) last: when a target's summary shows
`—` for TTFT and tok/s, it ran out of budget, so rerun with a larger `--budget`
rather than comparing it. Override those defaults with ordinary CLI options, for
example:

```bash
node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> \
  --mapping <provider> --profile load --budget 300000
```

Mappings come from the target gateway's `GET /v1/models` (derived from
`--url`), so Airside listings — carriers that exist only in the database and
never in `packages/models` — are benchmarked like catalogue mappings, with
`source: "airside"` in the target metadata. Pass `--catalogue static` only for
an offline run against the static catalogue, which has no Airside listings.
Pick comparison mappings that are active: `--mapping` rejects deactivated ones
unless `--include-deactivated` is set.

Do not pass `--output` or `--format`; the wrapper owns them. Set
`BENCHMARK_OUTPUT_DIR` when results belong elsewhere. The benchmark CLI reads
`LLM_GATEWAY_API_KEY`, falls back to `LLMGATEWAY_API_KEY`, and loads the root
`.env` file when it exists.

Airside portal checks use `createAirsideGatewayFetch` with the dedicated
`AIRSIDE_GATEWAY_API_KEY` on API and worker. Never fetch the provider directly
from those flows; generic admin benchmarks keep `BENCHMARK_GATEWAY_API_KEY`.

## Profiles

`smoke` (default), `standard`, `load`, and `coding`. `coding` measures agentic
performance: each case is a small task in a virtual repository that the model
must finish through a multi-turn `list_files` / `read_file` / `search` /
`write_file` / `run_tests` loop, and `run_tests` really executes the candidate
code. It reports solve rate, turns, tool calls, invalid and repeated tool calls,
end-to-end wall clock, and cost per solved task in an "Agentic coding" section.
Budget it generously — one task is many upstream requests:

```bash
node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> \
  --profile coding --budget 300000 --timeout 120000
```

A budget is a maximum per target, not total run time; targets run one after
another, so a run can take up to the budget times the number of mappings. A
request already in flight may finish after its target reaches the budget. Keep
cache and fallback disabled unless the user explicitly asks otherwise, so
results stay pinned to the selected mapping.

The wrapper preserves:

- `.json`: raw trials, responses, usage, cost, and stream events.
- `.md` and `.html`: built-in benchmark reports.
- `-timings.md`: timings grouped by target and case, including evaluator
  failures.
- `-timings.csv`: every trial's timing and usage fields.

## Against a local gateway

Point the run at the local gateway with `--url` and an api-key env var holding a
seeded token:

```bash
LOCAL_GATEWAY_KEY=test-token node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> \
  --url http://127.0.0.1:${GATEWAY_PORT:-4001}/v1/chat/completions --api-key-env LOCAL_GATEWAY_KEY
```

Do not use `LLM_GATEWAY_API_KEY` for this — the CLI loads the root `.env`, which
may already define it and point at production.

Start that gateway under an entry filename other than `serve.js`, detached into
its own session. Other worktrees on this machine kill stray gateways with
`pkill -f "dist/serve.js"`, which matches every worktree, and `nohup` does not
ignore `SIGTERM`. A mid-run kill shows up as `request_error: fetch failed` with
a near-zero `totalMs` on every remaining target, which is indistinguishable from
a provider outage in the report:

```bash
echo 'import "./serve.js";' > apps/gateway/dist/bench-serve.js
( cd apps/gateway && nohup python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    node --env-file=../../.env dist/bench-serve.js > /tmp/gateway.log 2>&1 < /dev/null & )
```

macOS has no `setsid` binary, hence the `python3` one-liner. Confirm the process
shows `PPID 1` before starting paid work, and kill it by PID afterwards.

If rendering fails after JSON is saved, render it without rerunning paid
requests:

```bash
node .agents/skills/model-benchmarks/scripts/render-results.mjs <absolute-json-path>
```

If a run makes requests but saves no JSON, report the loss and ask before
rerunning. Every trial of a target failing with `http_429` "maximum 0 requests
per day" means an admin rate limit blocks that mapping; report it instead of
comparing. A run measures a mostly idle endpoint with short prompts, so before
calling a provider fast or slow in production, benchmark the exact model in
question and compare with production rollups (`database` skill). After
completion, link the reports and summarize quality,
reliability, TTFT, total latency, throughput, buffering, truncation, cost, and
provider errors. For `coding`, also summarize solve rate, turns and tool calls
per task, invalid and repeated tool calls, and the stop reasons.
