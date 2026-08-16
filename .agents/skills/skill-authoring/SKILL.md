---
name: skill-authoring
description: Create, update, and audit repository-local agent skills against the current LLM Gateway codebase. Use when adding or editing files under .agents/skills or .claude/skills, reviewing a skill for stale instructions, or checking that skill paths, commands, cross-references, and workflows actually exist.
---

# Skill authoring

Write only instructions that are necessary and proven. Treat prompts, old skills,
and remembered workflows as leads, not evidence.

## Establish the source of truth

1. Read `AGENTS.md` and the files that implement the workflow.
2. Inventory both `.agents/skills` and `.claude/skills`, including hidden files
   and symlink targets. Keep the implementation in `.agents/skills`; expose
   every skill to Claude with a symlink.
3. Classify every operational claim before retaining it:

   - Repository fact: prove it with the current tree using `rg` or by reading the
     implementation.
   - Repository command: prove the script and package exist, then run a safe
     help or validation command when flags or behavior matter.
   - External API or product fact: use current authoritative documentation or a
     live non-destructive probe.
   - Machine capability: check it locally and state it as a precondition; never
     present one machine's installed tools or authentication behavior as a
     universal fact.

If a claim cannot be verified, remove it or label the exact check the agent must
perform at runtime. Never invent a missing skill, tool, port, command, or path to
bridge a workflow gap.

## Create or edit the skill

- Keep YAML frontmatter to `name` and `description`. Put all trigger phrases in
  the description.
- Keep the body concise and imperative. Link to `AGENTS.md` instead of copying
  large procedures that will drift.
- Use exact repository paths only after resolving them. Use placeholders only
  where the agent must choose a value.
- Keep cross-skill references repository-local unless the dependency is
  optional and checked at runtime.
- Add scripts only for repeated deterministic work. Run every added script.
- Remove unused references and assets.

## Validate

Run the repository skill audit from the repository root:

```bash
node .agents/skills/skill-authoring/scripts/check-skills.mjs
```

Then run the standard skill validator for each new or structurally changed skill
when it is available, followed by `pnpm format` and the build required by
`AGENTS.md`.

Review the final diff once more. Each instruction should have a concrete source:
repository code, a command result, authoritative documentation, or an explicit
runtime precondition.
