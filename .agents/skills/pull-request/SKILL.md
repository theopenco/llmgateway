---
name: pull-request
description: Create, update, illustrate, and hand off pull requests in this repo. Use when opening a PR, pushing a branch for review, writing or revising a PR title/description, embedding a screenshot or image in a PR body, triggering e2e CI on a PR, or whenever the user mentions "PR", "pull request", "open a PR", "update the PR", or "attach a screenshot to the PR".
---

# Pull requests

## Before opening

Run from the repository root, in this order:

```bash
pnpm format
pnpm build
```

Run relevant tests in the isolated environment required by `AGENTS.md`. Do not
run shared-state test files in parallel.

Never open a PR from `main` — branch first if you are on it.

## Self-review before opening

Most review happens before the PR exists. Before `gh pr create`:

1. **Prove it.** Run the thing the change affects — a test, a request against
   the isolated stack (`verify` skill), a screenshot — and keep the output.
   It goes under **Verification** in the PR body; "it builds" is not
   verification.
2. **Fresh-context review.** Hand `git diff origin/main...HEAD` and the
   intended behaviour to a subagent (or a new session) that has not seen the
   work, with `REVIEW.md` as its brief: hunt bugs (root cause on fixes, missed
   call sites, migration locks, cross-org data), simplify, and report findings
   as `file:line`. Fix or justify each one before pushing.
3. **Fill in Rollback.** State whether a plain revert of the squash commit is
   safe; if not, list the steps.

## After opening

- `pr-risk` labels the PR `risk: low|medium|high` and requests a maintainer
  review on `risk: high`.
- CodeRabbit posts a pre-merge checks table and findings as threads. Wait
  for both (`gh pr checks <n>` shows `CodeRabbit` as completed), fix every
  failed check (title length, description, rollback) and every finding, or
  resolve it with a one-line reason; unresolved threads block the merge.
  Docstring Coverage is CodeRabbit's default, not a repo rule; ignore it.
- When the same finding comes back on a second PR, fix it at the source
  (ESLint rule, skill line, `REVIEW.md`) in that PR.

## Creating the PR

Write the body from `.github/pull_request_template.md` into `.context/pr-body.md`:
Summary, Verification, Rollback (tick the plain-revert box or list the steps),
and Database migration only when the PR adds one.

```bash
gh pr create --base main --title "<type>(<scope>): <summary>" --body-file .context/pr-body.md
```

- Title uses conventional-commit format and is **max 50 characters**, `type(scope): ` included. Count it (`printf %s "<title>" | wc -c`) before creating or editing the PR.
- Always **ready-for-review**, never a draft, unless the user explicitly asks for a draft.
- Always write both a title **and** a description. If later commits change the scope, update both before handing the PR off — a stale description is worse than none.
- A good description states the problem first, then the approach, then anything a reviewer would otherwise have to reverse-engineer (non-obvious constraints, deliberate omissions, verification performed).
- **Never leak internal information.** This repository is public, and PR titles, descriptions, comments, commit messages and branch names are all permanently visible — editing them later does not remove them from the timeline or from anyone's email notifications. See the "no internal information" rule in AGENTS.md for the full list; in short, strip real user/customer names, email addresses, company names, org/project/user IDs, keys and tokens, dollar amounts, and internal dashboard/ticket links before you post. Say "a customer organization reported…", not who; say "the balance was miscalculated", not the amount. This applies to pasted logs, stack traces, SQL output and screenshots too — screenshots of the dashboards must come from locally seeded data, never from production.

## Pushing

- Use `git push -u origin <branch>`. Do not assume a Conductor workspace's
  transport or authentication method; use the configured remote and diagnose an
  actual authentication failure if one occurs.
- `gh pr create` needs the branch on the remote first, or an explicit `--head <branch>`.
- When checking out someone else's PR or a remote branch, set upstream so plain `git pull`/`git push` work: `gh pr checkout <n>`, or `git checkout -B <branch> FETCH_HEAD && git branch --set-upstream-to=origin/<branch>`.
- Force-push only on feature branches, never on `main`. Do not `--amend` a commit that is already pushed.

## Stacked pull requests

When a change has layers worth reviewing separately — a UI feature plus the permission model it needs, a refactor plus the behaviour built on it — split it into a **native GitHub stack** rather than one large PR. Each layer gets its own PR showing only its own diff, and layers can be reviewed in parallel.

Use the `gh stack` extension (`gh extension install github/gh-stack`). Do **not** hand-roll a stack by opening a PR whose `--base` points at another feature branch: it looks the same on day one, but GitHub then won't rebase or retarget the upper layers for you, and this repo squash-merges (merge commits are disabled), so the lower layer's commit lingers in the upper branch and turns into a conflict.

```bash
gh stack init feat/lower feat/upper   # adopts existing branches, bottom to top
gh stack submit --open                # pushes and creates/links ready PRs
gh stack view                         # see the stack and its PR links
gh stack rebase && gh stack push      # cascading restack onto the latest main
gh stack merge                        # only when the user asks to merge
```

Notes worth knowing:

- `gh stack init` adopts existing branches. Use `gh stack link` when existing PRs need to be linked without local tracking.
- Order the layers so each one is independently shippable: the bottom layer must make sense on its own even if the top never lands.
- Keep a file that both layers touch to a minimal edit in the upper one — that is where a restack conflict would surface.
- `gh stack submit --auto` creates drafts by default. Add `--open` whenever using
  `--auto` so this repository's ready-for-review rule is preserved.
- Check `gh stack <command> --help` before relying on behavior not shown here;
  the extension is versioned independently of the repository.

## Syncing a feature branch with main

**Default to a merge commit.** `git fetch origin && git merge origin/main` — it preserves the branch's existing commits and their pushed hashes, so review comments stay anchored, CI results stay valid, and nobody working from the branch has to recover from rewritten history.

Reach for `git rebase origin/main` only when it is required or clearly better, and say why. Legitimate reasons:

- The branch is unpushed and unshared, so nothing can break.
- A maintainer asked for linear history, or the PR is being prepared for a fast-forward merge.
- The branch has accumulated noisy merge commits from repeated syncs and needs tidying before review.
- A merge would produce a tangled conflict that a rebase resolves cleanly commit-by-commit.

Not reasons to rebase: "linear history is nicer", or habit.

After a rebase, force-push with `--force-with-lease` (never plain `--force`) to update the PR — do this automatically, without pausing to confirm. If the local branch name differs from the remote PR branch, push with an explicit `local:remote` refspec.

Migration conflicts are the one case with a fixed recipe, and it is merge-shaped — see the `migrations` skill: reset `packages/db/migrations/` to `origin/main` **before** merging, then regenerate with `pnpm migrations --name <name>` after.

## When to include screenshots

Screenshots are only for changes to the four dashboard UIs: `apps/ui`,
`apps/code`, `ee/admin`, and `apps/airside`. For those, always embed the
affected screens: a before/after pair for changes to an existing screen, and
both themes for anything with light and dark styling.

Skip screenshots for `apps/docs` and other content-only changes (marketing copy,
changelog entries, MDX prose); link the changed file instead.

## Embedding a screenshot in the PR body

Keep screenshot binaries out of the feature diff. Push the image as an orphan
asset commit, reference it by commit SHA, and keep its asset branch reachable
during review:

```bash
BLOB=$(git hash-object -w shot.png)
TREE=$(printf '100644 blob %s\tshot.png\n' "$BLOB" | git mktree)
COMMIT=$(git commit-tree "$TREE" -m "chore: screenshot asset for PR #<n>")

# Use the literal SHA here — "$COMMIT:refs/heads/..." mangles the refspec in zsh.
git push origin <COMMIT>:refs/heads/assets/pr-<n>
```

Then put this in the PR body:

```markdown
<img width="1440" alt="<what it shows>" src="https://raw.githubusercontent.com/theopenco/llmgateway/<COMMIT>/shot.png" />
```

Why it is shaped this way:

- The plumbing (`hash-object` / `mktree` / `commit-tree`) builds the commit without ever touching the working tree or switching branches, so it is safe to run mid-task on a dirty tree.
- Pin the URL to the commit SHA.
- Keep `assets/pr-<n>` until the PR is merged or closed so the commit remains
  reachable during review. Delete the branch afterward with
  `git push origin --delete assets/pr-<n>`.

Use the `verify` skill to launch an isolated stack and capture the screenshot.

## CI

The e2e workflow does **not** run automatically on PRs — e2e spends real money on provider API calls. Trigger it on demand by commenting `/e2e` on the PR (maintainers/collaborators only, and only for branches in this repository, not forks), or via `workflow_dispatch`. Use it only for generic gateway code changes whose
effect across models needs checking. NEVER comment `/e2e` on PRs that add or
edit model mappings: run those locally scoped with `TEST_MODELS`, or dispatch
with `test_models` and `full_mode` when local credentials are missing (`add-model` skill).

## Auto-merge means ship it

When the user explicitly asks to set a PR to auto-merge, enable it
(`gh pr merge <n> --auto --squash`) and own the PR until it runs in production:

1. Run `.agents/skills/pull-request/scripts/wait-for-pr.sh <n>` as a background
   job until it exits 0 (merged). Exit 3 means the PR needs you: a failed check,
   a merge conflict, a branch behind its base branch, a green PR still blocked
   (usually a required review), or an unresolved review thread. Unresolved threads block auto-merge even when every
   check is green, and CodeRabbit can open new ones after each push. Fix the
   cause or reply and resolve the thread (see "After opening"), push, and run
   the script again. Exit 1 means the PR closed without merging or the watch
   timed out; check the PR before rerunning. Exit 4 means GitHub requests kept
   failing; check network and `gh auth status`, then rerun. Never bypass checks
   (see `AGENTS.md`).
2. Follow the rollout through the deployment repository: the image-bump PR for
   the merge commit, its merge, and the deploy run it triggers. If the deploy
   fails for a reason unrelated to the change, report it rather than changing
   shared infrastructure.
3. With `kubectl` pointed at production, run
   `.agents/skills/pull-request/scripts/wait-for-rollout.sh <merge-sha>`
   (extra arguments go to `kubectl`, e.g. `--context <ctx>`). It exits 0 once
   every deployment of our `ghcr.io/theopenco/llmgateway-*` images is ready on
   one tag whose commit contains the merge commit. A later image bump often
   ships the commit first, so the merge commit's own tag may never run;
   third-party images are skipped. Exit 4 means `kubectl` failed several times
   in a row, or the selected context and namespace hold no deployment of our
   images (third-party ones do not count); fix access or point it at the
   production namespace. Exit 1 means the timeout passed without a live
   rollout: report what is stuck (its last output shows the tags and the
   deployments not ready) and do not call it live. Only on exit 0, send a final
   message saying it is live.

Run both scripts as background jobs instead of polling in the conversation.
Without `kubectl` access, confirm the deploy run succeeded and say the pods were
not checked.
