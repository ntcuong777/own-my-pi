---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Superpowers works better with subagents. If subagents are available, use superpowers:subagent-driven-development instead of this skill. Implementers write code+tests; this session merges and verifies.

## The Process

### Step 1: Load and Review Plan

1. Ensure an isolated workspace if needed: use superpowers:using-git-worktrees to create one or verify the existing one (code isolation only — that skill does not require install/test in the tree)
2. Read plan file
3. Review critically - identify any questions or concerns about the plan
4. If concerns: Raise them with your human partner before starting
5. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:

**With subagents:** dispatch implementer (code + tests) → merge → verify here (`verification-before-completion`) → adjust tests if glue/env is wrong → re-dispatch only if implementation is wrong → commit in this session.

**Inline (this session does the writing):**

1. Mark as in_progress
2. Write implementation and tests
3. Run verifications as specified, in this environment
4. Adjust tests if needed; fix impl if behavior is wrong
5. Mark as completed
6. Commit here if the human wants commits as you go

Do not load `test-driven-development`. Tests are a deliverable, not a red-green ceremony the isolated worker must execute.

### Step 3: Complete Development

After all tasks complete and verified:

- Run full verification in this environment
- Optional: superpowers:requesting-code-review
- Integrate how the human asked (commit, PR, stop)
- superpowers:finishing-a-development-branch is optional, not required

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly after refine + re-dispatch

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember

- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications (controller runs them)
- Implementers write code + tests, then format; they do not install or run the suite
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent