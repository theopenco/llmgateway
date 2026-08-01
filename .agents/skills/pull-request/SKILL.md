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
- End the body with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

## Pushing

- In Conductor workspaces SSH push fails; use the gh credential helper over HTTPS:

  ```bash
  git -c credential.helper='!gh auth git-credential' push -u origin <branch>
  ```

- `gh pr create` needs the branch on the remote first, or an explicit `--head <branch>`.
- When checking out someone else's PR or a remote branch, set upstream so plain `git pull --rebase`/`git push` work: `gh pr checkout <n>`, or `git checkout -B <branch> FETCH_HEAD && git branch --set-upstream-to=origin/<branch>`.
- Force-push only on feature branches, never on `main`. Do not `--amend` a commit that is already pushed.
- After rebasing a feature branch onto `main`, force-push it without asking.

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
