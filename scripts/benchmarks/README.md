# Smart Routing pilot

A fixed workload comparing `smart` with three fixed-model baselines. This is a
single-turn, text-only pilot, not a production traffic sample or a full IFEval
score. The exact model strings and request order are in `protocol.json`.

From the repository root:

```bash
pnpm exec turbo run build --filter=@llmgateway/benchmarks
mkdir -p .context/benchmarks/smart-routing
curl --fail --silent --show-error \
  https://raw.githubusercontent.com/google-research/google-research/d36068b845da4c2b24927fee2cea1e6ef98dadda/instruction_following_eval/data/input_data.jsonl \
  -o .context/benchmarks/smart-routing/ifeval.jsonl
pnpm exec tsx scripts/benchmarks/smart-routing.ts --prepare
```

Check the protocol before paying for requests. Configure the project's Smart
Routing candidates and Jev classifier in the dashboard. Export
`LLM_GATEWAY_API_KEY`, then run:

```bash
pnpm exec tsx scripts/benchmarks/smart-routing.ts
```

Use `BENCHMARK_DIR` for a different output directory. Set
`BENCHMARK_MAX_TOKENS=4096` to reproduce the initial cap-sensitivity run; the
default is 8192. The lower cap suppresses Smart Routing's medium reasoning
default for high-difficulty requests, so the higher-cap run is the primary
comparison. Never combine trials from the two protocols. Keep it gitignored: raw
responses and usage snapshots contain private request identifiers and costs.
The runner saves every completed trial and skips it on resume. Investigate a
missing-usage stop or an interrupted request before resuming; an upstream may
have charged for an unfinished request. The spending guard leaves headroom,
checks key usage before each prompt block, and reserves classifier overhead.
It is not an account-level spending limit. Concurrent unrelated key usage can
stop a run early.

The workload is fixed before execution: 25 generated easy tasks, all 15 existing
exact-answer quality cases, and 40 seeded-shuffled cases from the 334 supported by the
repository's IFEval adapter (541 in the source dataset). Each prompt runs once per arm in shuffled order,
serially, with an 8,192-token output cap. Gateway response caching and
cross-provider fallback are disabled. Upstream prompt caching remains possible. Fixed-model arms retain gateway
provider selection. Client timings include network and gateway delays; the
export also preserves logged inference duration for comparison.
Reasoning and temperature use the models' defaults, including Smart Routing's
reasoning adjustment. This measures the complete configured service; it does
not isolate the classifier from those defaults.

## Reconcile the classifier

Completion usage excludes the separately billed classifier. For each saved
request ID, retrieve its entries through the authenticated
internal API's `GET /logs?requestId=...`. Request-level lookup is necessary
because aggregate usage does not contain the classifier's routing decision or
its relationship to an individual inference. Do not use a broad log scan.

Save the responses privately as `billing.json`:

```json
{
  "done": true,
  "error": null,
  "rows": [{ "caseId": "fixture-id", "arm": "smart", "logs": [] }]
}
```

Each `logs` array must contain the actual API results for that case, including
its inference row and classifier row when billed. Then run:

```bash
pnpm exec tsx scripts/benchmarks/analyze-smart-routing.ts
```

The analysis requires complete pairs, checks inference charges against stored
logs, checks classifier charges against routing metadata, and includes storage
for both rows. It writes a private report with absolute charges and a public
report with normalized costs, response text, scores, token counts, timings,
and routing decisions. Client token counts can be partial on an interrupted
stream; `billedUsage` preserves the log’s token counts alongside them. A client
error remains a failure even when the server recorded a billable cancellation.
Public output excludes request, account, and credential
identifiers. Inspect it before publication.

## Scoring and uncertainty

IFEval scores instruction adherence, not factual correctness or prose quality.
The exact-answer tasks use deterministic reference answers. An API error or
truncated completion fails even if a partial response satisfies the checker.

Keep the original strict scores. Also report a sensitivity check that excludes
contradictory IFEval case 3369 for every arm and accepts an optional trailing
period on all five lowercase-conversion tasks. Their punctuation is ambiguous.
The sensitivity result has 79 prompts; the original has 80.

Cost savings and pass-rate differences use 10,000 paired bootstrap resamples,
stratified by the three workload groups. These intervals describe resampling
this pilot's prompts. They do not measure between-day routing variation or
establish quality equivalence. Inspect the official IFEval scorer separately
before calling the adapter's score equivalent to it.

IFEval data and evaluators are from
[Google Research](https://github.com/google-research/google-research/tree/d36068b845da4c2b24927fee2cea1e6ef98dadda/instruction_following_eval),
licensed under Apache 2.0. See the license accompanying the published fixtures.

If a failed call omits usage, the runner stops. Match its request ID to the
billing log, then store the verified `cost` and `storageCost` under that request
ID in the private `reconciled-errors.json` object. Resume only after checking
those charges. The original error remains a failed trial and is never retried.
Both `length` and `incomplete` finish reasons count as truncation.

## Optional Saina routing arm

The open-weights [Saina Helm 2 Routing](https://huggingface.co/run-saina/saina-helm-2-routing-0.8b)
arm selects a fixed-arm model from the request, capability descriptions and
estimated request prices. It does not see candidate model identifiers or fixture
answers. This adds a fifth arm; use a **fresh** benchmark directory and rerun all
arms. Existing fixtures, scoring, output caps, failure rules and bootstrap strata
remain unchanged. Arm execution order is reshuffled with the additional arm.

Create a private JSON config and set `SAINA_CONFIG` to its path. It has:

- `model`: `saina-helm-2-routing-0.8b`.
- `revision`: `6c99c8cdd87d0cfd2ecfb05650bb25b803b863fd` (merged weights).
- `classifierReserveUsd`: a positive decimal string reserving classifier cost per
  call in the spending guard. It must cover your expected routing charge.
- `candidates`: at least two distinct fixed-arm models, each with `model`,
  `description`, and `estimatedRequestCostUsd` (a nonnegative decimal string).

Write descriptions and prices before the run using independent information;
do not derive them from this pilot's answers. Candidate order, descriptions,
prices, question, revision and adapter hash are frozen in `protocol.json`.
Record how the pool compares with the project's configured Smart Routing pool;
a different pool is a different treatment, not an isolated classifier comparison.
The downstream call keeps the fixed model's defaults, without Smart Routing's
reasoning adjustments.

Set `SAINA_API_KEY` and optionally `SAINA_BASE_URL` (default
`https://api.saina.run`), then use the same prepare/run commands above. For local
open-weights inference, install `saina[local,server]>=0.4.0`, set `SAINA_MODELS` to
`run-saina/saina-helm-2-routing-0.8b@6c99c8cdd87d0cfd2ecfb05650bb25b803b863fd:32768`,
set the server's `SAINA_API_KEY`, and start `uvicorn saina.server:create_app --factory`.
Point `SAINA_BASE_URL` at its loopback origin. Endpoint URLs and credentials are
not written into the protocol. The runner verifies the served revision before
and after execution. Keep the server pinned for the entire run.

Routing is serial and uncached. Its wall time is included in total latency and
time to first content, and subtracted from the downstream timeout. Setup checks
are outside request timing. Router failures count as failed trials with no
fallback or downstream call. Private `saina-routing.jsonl` records each decision
before generation and is reused on resume. If `saina-pending.json` remains after
an interruption, reconcile that request before clearing the marker; do not
silently pay for another routing attempt.

Before analysis, save private `saina-billing.json`: an array with one entry per
Saina trial, including failed routes. Each entry has `caseId`, `cost` (total router
charge as a nonnegative decimal string), and `basis` (`billed` or `estimated`).
Use actual API billing where available. For self-hosting, include a documented
compute-cost estimate, including failed routing attempts; estimates are labeled
in the summaries. Never substitute zero for an unknown charge. The reserve is a
spending precaution, not measured billing. Analysis refuses missing charges.

Collect the downstream gateway logs in `billing.json` as usual. A failed router
has an empty `logs` array because no generation was requested. Analysis adds the
external router charge to downstream inference and storage costs and reports
paired comparisons for both routers. The same strict and 79-prompt sensitivity
rules apply. Raw routing records and billing files stay private. This integration
does not ship benchmark results or make a quality/cost claim.

Adapter and analysis regression tests (mocked requests; no paid API calls):

```bash
pnpm exec tsx --test scripts/benchmarks/saina-*.test.ts
```
