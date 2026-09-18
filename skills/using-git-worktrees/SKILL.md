---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback
---

# Using Git Worktrees

## Overview

Ensure work happens in an isolated workspace. Prefer your platform's native worktree tools. Fall back to manual git worktrees only when no native tool is available.

**Core principle:** Detect existing isolation first. Then use native tools. Then fall back to git. Never fight the harness.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

Isolation is for **edits** (code and tests). Do not treat the worktree as a second runnable environment. Skip dependency install and project test runs unless the human explicitly asks to execute code there. Verification belongs to the controller session after the work is merged.

## Step 0: Detect Existing Isolation

**Before creating anything, check if you are already in an isolated workspace.**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**Submodule guard:** `GIT_DIR != GIT_COMMON` is also true inside git submodules. Before concluding "already in a worktree," verify you are not in a submodule:

```bash
# If this returns a path, you're in a submodule, not a worktree — treat as normal repo
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**If `GIT_DIR != GIT_COMMON` (and not a submodule):** You are already in a linked worktree. Skip to Step 2 (Project Setup). Do NOT create another worktree.

Report with branch state:
- On a branch: "Already in isolated workspace at `<path>` on branch `<name>`."
- Detached HEAD: "Already in isolated workspace at `<path>` (detached HEAD, externally managed). Branch creation needed at finish time."

**If `GIT_DIR == GIT_COMMON` (or in a submodule):** You are in a normal repo checkout.

**Declared preference (always-on):** Always create an isolated worktree. Never ask consent. Never work in place unless already in a linked worktree (this Step 0) or sandbox blocks `git worktree add`.

Do **not** ask: "Would you like me to set up an isolated worktree?"

## Step 1: Create Isolated Workspace

**You have two mechanisms. Try them in this order.**

### 1a. Native Worktree Tools (preferred)

Consent is already granted by declared preference. Do you already have a way to create a worktree? It might be a tool with a name like `EnterWorktree`, `WorktreeCreate`, a `/worktree` command, or a `--worktree` flag.

**Placement constraint:** Native tool is allowed **only** if it creates the checkout at `<git-root>/.worktrees/<branch>`. If it would place the tree as a sibling of the repo, under `/tmp`, under the home directory, or any other path, do **not** use it — fall through to Step 1b.

If native tool honors `<git-root>/.worktrees/<branch>`, use it and skip to Step 2.

Native tools that honor that path handle branch creation and cleanup. Using `git worktree add` when a compliant native tool exists creates phantom state your harness can't see or manage.

Only proceed to Step 1b if you have no compliant native worktree tool.

### 1b. Git Worktree Fallback

**Only use this if Step 1a does not apply** — you have no native worktree tool that places the checkout at `<git-root>/.worktrees/<branch>`. Create a worktree manually using git.

#### Directory Selection

**Forced location:** `<git-root>/.worktrees/<branch>`.
`git-root` = `git rev-parse --show-toplevel`.

Never sibling dirs (`../repo-feature`). Never unhidden `worktrees/`. Never `/tmp` or `$HOME` checkouts. Keep every worktree under the same git root.

```bash
GIT_ROOT=$(git rev-parse --show-toplevel)
LOCATION="$GIT_ROOT/.worktrees"
mkdir -p "$LOCATION"
```

#### Safety Verification (project-local directories only)

**MUST verify directory is ignored before creating worktree:**

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**If NOT ignored:** Add to .gitignore, commit the change, then proceed.

**Why critical:** Prevents accidentally committing worktree contents to repository.

#### Create the Worktree

```bash
# Determine path based on chosen location
path="$LOCATION/$BRANCH_NAME"

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**Sandbox fallback:** If `git worktree add` fails with a permission error (sandbox denial), tell the user the sandbox blocked worktree creation and you're working in the current directory instead. Do not install dependencies or run tests as a consolation setup.

## Step 2: Project Setup

**Default: skip.** Do not auto-detect and run install/build:

```bash
# Node.js — skip unless asked
# if [ -f package.json ]; then npm install; fi

# Rust — skip unless asked
# if [ -f Cargo.toml ]; then cargo build; fi

# Python — skip unless asked
# if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
# if [ -f pyproject.toml ]; then poetry install; fi

# Go — skip unless asked
# if [ -f go.mod ]; then go mod download; fi
```

A worktree shares git objects, not the controller session's shells, package installs, or toolchains. Installing there duplicates environment work and often fails. Subagents should write code and tests; the controller verifies after merge.

If the human **explicitly** wants a runnable worktree, then run the project's documented setup — still skip inventing a setup the repo does not use.

## Step 3: Verify Clean Baseline

**Default: skip.** Do not run `npm test` / `cargo test` / `pytest` / `go test ./...` to prove the worktree is clean.

That proof belongs in the controller session after edits land (`verification-before-completion`). A dirty baseline in an uninstalled tree is expected and not a reason to stop.

If the human asked to execute code in this worktree **and** setup already ran, then run the project tests and report failures.

### Report

```
Worktree ready at <full-path>
Setup: skipped (code-only isolation)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| Consent / where to put tree | Never ask. Always `<git-root>/.worktrees/<branch>` |
| Already in linked worktree | Skip creation (Step 0) |
| In a submodule | Treat as normal repo (Step 0 guard) |
| Native tool that uses `.worktrees/<branch>` | Use it (Step 1a) |
| Native tool that uses any other path | Ignore it; git fallback (Step 1b) |
| No native tool | Git worktree fallback (Step 1b) |
| Directory not ignored | Add `.worktrees/` to .gitignore + commit |
| Permission error on create | Sandbox fallback, work in place |
| Need deps or tests | Controller session after merge, unless human asked to run code here |
| No package.json/Cargo.toml | Skip dependency install (always the default) |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'm obviously not in a worktree — no need to check" | Run Step 0. Harness-created isolation and submodules both fool eyeballing; the detection commands settle it. |
| "`git worktree add` is quicker than hunting for a native tool" | A native tool (e.g. `EnterWorktree`) owns placement, branching, and cleanup. Bypassing it is the #1 mistake — it creates phantom state your harness can't see or manage. |
| "The worktree directory is surely ignored already" | Run `git check-ignore`. An unignored worktree directory commits the whole tree into the repo. |
| "Any directory name works" | Location is forced: `<git-root>/.worktrees/<branch>` only. |
| "The workspace is fresh — I must npm install and run baseline tests" | Isolation is for edits. Install/test in the controller session after merge unless the human asked to run code here. |
