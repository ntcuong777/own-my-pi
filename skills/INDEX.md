# Skill Index

Pi loads these from `$HOME/.pi/agent/skills`. Host `settings.json` also
points at `$HOME/.claude/skills` and `$HOME/.codex/skills`. Pi already
scans `$HOME/.agents/skills`. Shared names belong only here;
leftover `$HOME/.agents/skills/<name>` copies are dropped on Home
Manager activation.

Frequent skills stay top-level. `skill-library` is the lazy catalog.

## Active top-level skills

- `brainstorming`
- `caveman`
- `caveman-commit`
- `caveman-compress`
- `caveman-help`
- `caveman-review`
- `executing-plans`
- `find-skills`
- `receiving-code-review`
- `requesting-code-review`
- `security-review`
- `skill-library`
- `subagent-driven-development`
- `systematic-debugging`
- `testing-best-practices`
- `using-git-worktrees`
- `verification-before-completion`
- `writing-plans`
- `writing-skills`

## Lazy library

`$HOME/.pi/agent/skills/skill-library/`

Topics:

- `software-engineering/` (includes mattpocock-skills)
- `languages/`
- `devops/`
- `security/`
- `testing/`
- `business/`
- `emacs/`
