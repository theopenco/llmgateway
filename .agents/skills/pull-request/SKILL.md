---
name: pull-request
description: Create, update, illustrate, and hand off pull requests in this repo. Use when opening a PR, pushing a branch for review, writing or revising a PR title/description, embedding a screenshot or image in a PR body, triggering e2e CI on a PR, or whenever the user mentions "PR", "pull request", "open a PR", "update the PR", or "attach a screenshot to the PR".
---

# Pull requests

## Before opening

Run from the repository root, in this order:

```bash
pnpm format                       # always
pnpm build                        # always after finishing a feature; required if API routes changed
pnpm test:unit                    # scope to the specs you touched
```

Never open a PR from `main` — branch first if you are on it.

## Creating the PR

```bash
gh pr create --base main --title "<type>(<scope>): <summary>" --body "$(cat <<'EOF'
...
EOF
)"
```

- Title uses conventional-commit format and is **max 50 characters**.
- Always **ready-for-review**, never a draft, unless the user explicitly asks for a draft.
- Always write both a title **and** a description. If later commits change the scope, update both before handing the PR off — a stale description is worse than none.
- A good description states the problem first, then the approach, then anything a reviewer would otherwise have to reverse-engineer (non-obvious constraints, deliberate omissions, verification performed).
- **Never leak internal information.** This repository is public, and PR titles, descriptions, comments, commit messages and branch names are all permanently visible — editing them later does not remove them from the timeline or from anyone's email notifications. See the "no internal information" rule in AGENTS.md for the full list; in short, strip real user/customer names, email addresses, company names, org/project/user IDs, keys and tokens, dollar amounts, and internal dashboard/ticket links before you post. Say "a customer organization reported…", not who; say "the balance was miscalculated", not the amount. This applies to pasted logs, stack traces, SQL output and screenshots too — screenshots of the dashboards must come from locally seeded data, never from production.
- End the body with:

  ```text
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

## Pushing

- In Conductor workspaces SSH push fails; use the gh credential helper over HTTPS:

  ```bash
  git -c credential.helper='!gh auth git-credential' push -u origin <branch>
  ```

- `gh pr create` needs the branch on the remote first, or an explicit `--head <branch>`.
- When checking out someone else's PR or a remote branch, set upstream so plain `git pull`/`git push` work: `gh pr checkout <n>`, or `git checkout -B <branch> FETCH_HEAD && git branch --set-upstream-to=origin/<branch>`.
- Force-push only on feature branches, never on `main`. Do not `--amend` a commit that is already pushed.

## Stacked pull requests

When a change has layers worth reviewing separately — a UI feature plus the permission model it needs, a refactor plus the behaviour built on it — split it into a **native GitHub stack** rather than one large PR. Each layer gets its own PR showing only its own diff, and layers can be reviewed in parallel.

Use the `gh stack` extension (`gh extension install github/gh-stack`). Do **not** hand-roll a stack by opening a PR whose `--base` points at another feature branch: it looks the same on day one, but GitHub then won't rebase or retarget the upper layers for you, and this repo squash-merges (merge commits are disabled), so the lower layer's commit lingers in the upper branch and turns into a conflict.

```bash
gh stack init feat/lower feat/upper   # adopts existing branches, bottom to top
gh stack submit                       # pushes and creates/links the PRs (--auto to skip the editor)
gh stack view                         # see the stack and its PR links
gh stack rebase && gh stack push      # cascading restack onto the latest main
gh stack merge                        # land the stack, or merge layers individually
```

Notes worth knowing:

- `gh stack init` **adopts** branches that already exist and finds their open PRs, so an already-split pair of PRs can be converted into a stack without losing descriptions, screenshots, or review history. `gh stack submit` then reports them "up to date" and just links them.
- Order the layers so each one is independently shippable: the bottom layer must make sense on its own even if the top never lands.
- Keep a file that both layers touch to a minimal edit in the upper one — that is where a restack conflict would surface.
- `gh stack rebase` rebases onto `origin/main`. It warns and falls back harmlessly if another worktree has `main` checked out, which is normal in Conductor.
- Once merged, GitHub rebases and retargets every layer above automatically; you do not need to retarget bases by hand.

## Syncing a feature branch with main

**Default to a merge commit.** `git fetch origin && git merge origin/main` — it preserves the branch's existing commits and their pushed hashes, so review comments stay anchored, CI results stay valid, and nobody working from the branch has to recover from rewritten history.

Reach for `git rebase origin/main` only when it is required or clearly better, and say why. Legitimate reasons:

- The branch is unpushed and unshared, so nothing can break.
- A maintainer asked for linear history, or the PR is being prepared for a fast-forward merge.
- The branch has accumulated noisy merge commits from repeated syncs and needs tidying before review.
- A merge would produce a tangled conflict that a rebase resolves cleanly commit-by-commit.

Not reasons to rebase: "linear history is nicer", or habit.

After a rebase, force-push with `--force-with-lease` (never plain `--force`) to update the PR — do this automatically, without pausing to confirm. If the local branch name differs from the remote PR branch, push with an explicit `local:remote` refspec.

Migration conflicts are the one case with a fixed recipe, and it is merge-shaped — see the `migrations` skill: reset `packages/db/migrations/` to `origin/main` **before** merging, then regenerate with `pnpm migrations` after.

## Embedding a screenshot in the PR body

GitHub's drag-and-drop uploader (`user-images.githubusercontent.com`) is browser-session-only and unreachable with an API token, so it cannot be used here. Do **not** commit the image into the PR branch either — that adds a binary to the diff.

Instead push the image as a throwaway orphan commit, reference it **by commit SHA**, then delete the branch:

```bash
BLOB=$(git hash-object -w shot.png)
TREE=$(printf '100644 blob %s\tshot.png\n' "$BLOB" | git mktree)
COMMIT=$(git commit-tree "$TREE" -m "chore: screenshot asset for PR #<n>")

# Use the literal SHA here — "$COMMIT:refs/heads/..." mangles the refspec in zsh.
git -c credential.helper='!gh auth git-credential' \
  push origin <COMMIT>:refs/heads/assets/pr-<n>
```

Then put this in the PR body and delete the branch:

```markdown
<img width="1440" alt="<what it shows>" src="https://raw.githubusercontent.com/theopenco/llmgateway/<COMMIT>/shot.png" />
```

```bash
git -c credential.helper='!gh auth git-credential' push origin --delete assets/pr-<n>
```

Why it is shaped this way:

- The plumbing (`hash-object` / `mktree` / `commit-tree`) builds the commit without ever touching the working tree or switching branches, so it is safe to run mid-task on a dirty tree.
- **Pin the URL to the commit SHA, never the branch name.** After the branch is deleted the blob stays retrievable by SHA; a branch-name URL only _appears_ to keep working because `raw.githubusercontent.com` is CDN-cached, and it 404s once that expires.
- Verify retention with the Git object API, which is not CDN-fronted — a `200` from `raw.githubusercontent.com` alone proves nothing:

  ```bash
  gh api repos/theopenco/llmgateway/git/blobs/<BLOB>   # .size on success
  ```

- Caveat: the commit is unreachable once the branch is gone, so GitHub _may_ eventually garbage-collect it. Fine for a PR that merges within days; if the image must live indefinitely, keep the `assets/*` branch instead of deleting it.
- Clean up after yourself — a stray `assets/*` branch left on the remote is litter.

To produce the screenshot itself, see the `verify` skill for launching the stack on offset ports. Drive it with Playwright; the Playwright MCP server can only write under the repo's `.playwright-mcp/`, so to control the output path use `@playwright/test` directly from a package that depends on it (`apps/playground` or `apps/code`).

## CI

The e2e workflow does **not** run automatically on PRs — e2e spends real money on provider API calls. Trigger it on demand by commenting `/e2e` on the PR (maintainers/collaborators only, and only for branches in this repository, not forks), or via `workflow_dispatch`.
