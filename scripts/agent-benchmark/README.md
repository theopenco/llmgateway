# Coding agent token benchmark

Measures how many tokens Empryo, Claude Code and OpenCode spend to fix the same
real bugs with the same models, all billed through LLM Gateway.

## What it runs

- **Tasks**: three merged bug fixes from [honojs/hono](https://github.com/honojs/hono),
  listed in `tasks.json`. Each run starts from the parent of the fix commit, with no
  git history, and gets an issue-style prompt that does not name the files to change.
- **Grading**: after the agent exits, the fix commit's own test file is copied over the
  agent's copy and run with vitest. A run counts as solved only if those upstream tests pass.
- **Models**: `models.json`, each pinned to one provider so every agent hits the same
  upstream and prompt cache.
- **Agents**: run headless with their defaults.
  - Claude Code: `claude -p --dangerously-skip-permissions --output-format json`, with
    `ANTHROPIC_BASE_URL=https://api.llmgateway.io` and every model slot (Opus, Sonnet,
    Haiku, subagents) set to the model under test.
  - OpenCode: `opencode run --auto --format json` with the built-in `llmgateway`
    provider. `small_model` is set to the model under test.
  - Empryo: `empryo --headless --json --mode auto` with the built-in `llmgateway` provider,
    version 3.11.0-beta or later (`empryo update`); each run's `result.json` records the exact
    `agentVersion` and the `agentConfig` it ran with. Its fresh config sets the Anthropic
    prompt cache to five minutes (`cache.ttl: "5m"`), the same lifetime Claude Code and
    OpenCode use. Older builds asked for a one-hour cache, which costs 1.6x more per write
    and never pays off on runs that finish in a minute or two.
    The same config pins every experimental feature off (finish check, not-done nudge,
    cold prune, request map, fix history, edit echoes, code mode, learned tool loading,
    heavy-work slots, compact on resume), keeping only the default "instruction edits as
    messages". Skills (auto-manage, autoload, the `skills` tool, live refresh) and
    instruction files (`EMPRYO.md`, `CLAUDE.md`, `AGENTS.md` and the rest) are off, so a
    runner's own Empryo setup cannot add requests or prompt tokens.

Each run gets a fresh `HOME` (and a fresh `EMPRYO_HOME`), so no user-level
instructions, memory, plugins, skills or MCP servers leak in. The project files are
the same for every agent.

## How tokens are counted

Every agent talks to `https://api.llmgateway.io` through `HTTPS_PROXY`, pointed at
`proxy.mjs`. The proxy terminates TLS with a local CA (trusted through
`NODE_EXTRA_CA_CERTS`), forwards each request unchanged and records the usage block the
gateway returned (OpenAI chat, Responses or Anthropic Messages format) into
`results/<suite>/<run>/requests.jsonl`. All three agents are measured by the same code,
from the same responses the gateway billed, rather than by their own counters.
Each line also counts the request's messages by role (`roles`: system, user, assistant, tool
results) and the characters of non-tool user content (`userChars`), so text an agent injects
between steps shows up without logging prompt bodies.

- **Input tokens** include cached reads and cache writes.
- **Cost** is computed per request from the pinned provider's list prices in
  `models.json`. The suite's `key-usage.jsonl` records the API key's billed usage
  before and after each batch as a cross-check.

## Reproduce

Requires Node 24, Bun, git, openssl, and the three CLIs on `PATH`.

```bash
export LLM_GATEWAY_API_KEY=llmgtwy_...
node scripts/agent-benchmark/setup.mjs
node scripts/agent-benchmark/run.mjs --suite my-run --reps 1 --concurrency 6
node scripts/agent-benchmark/report.mjs my-run
```

`setup.mjs` clones hono, installs each task's base commit, saves the hidden tests and
generates the local CA under `~/agent-benchmark-work` (override with `BENCH_HOME`).
It also builds Empryo's code index once per task base, outside the timed run, the way a
project you already work in is indexed. Building the index needs no model: Empryo indexes
before its first request, and setup runs it with a placeholder key so that request is
refused and nothing is billed. Each run copies the base with its index, and `.empryo/` is
excluded from git so the index never shows up in the patch or the grade.
`run.mjs` takes `--agents`, `--models`, `--tasks`, `--reps`, `--concurrency` and
`--timeout-min`, and skips runs that already have a `result.json`, so an interrupted suite
resumes where it stopped. Before each run it checks the key and organization balance and stops
queuing new runs once `--max-spend` USD has been spent in this invocation, or when organization
credits (or the key's remaining limit) drop below `--min-credits` (default 2). A half-funded run
would end in a 402 mid-task and skew the token counts, so the guard stops cleanly instead. `report.mjs` writes `summary.json` and `summary.md`.

Each run directory keeps `result.json`, `requests.jsonl` (one line per model call, no
prompt bodies), the agent's `patch.diff`, the grading log and the tail of the agent's output.
