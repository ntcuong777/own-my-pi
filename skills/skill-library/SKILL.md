---
name: skill-library
description: Find local specialist skills and load only matching guidance from the lazy topic library.
argument-hint: "<skill-name>|list|search <query>"
---

# Local Skill Library

Use this catalog when task needs specialist guidance beyond top-level active skills.

1. Match task keywords against entries below.
2. Select at most two matching skills unless task explicitly requires more.
3. Resolve `$HOME` yourself, then read exact listed `SKILL.md` path.
4. Read nested references only when selected skill requires them.
5. Do not load unrelated skills. Catalog paths point to installed skill paths, not repository paths.

## Command forms

Use invocation argument as command:

- `/skill-library list` — list all lazy skills grouped by topic. Show names and one-line descriptions; omit full paths unless requested.
- `/skill-library search <query>` — search names, aliases, descriptions, and trigger terms; show matching entries with exact paths.
- `/skill-library <skill-name>` — resolve exact name or alias, read its listed `SKILL.md`, then apply it to current task.
- `/skill-library` — show these command forms and suggest likely matches from current task.

For `<skill-name>`, do not merely describe the skill. Load its `SKILL.md` from resolved `$HOME/.pi/agent/skills/...` path and follow it.

## Software engineering

- `architecture-patterns`: Clean/Hexagonal Architecture, DDD, dependency cycles — `$HOME/.pi/agent/skills/skill-library/software-engineering/architectural-patterns/SKILL.md`
- `git-best-practices`: Git workflow and repository safety — `$HOME/.pi/agent/skills/skill-library/software-engineering/git-best-practices/SKILL.md`
- `git-rebase-sync`: synchronize rebases and branches — `$HOME/.pi/agent/skills/skill-library/software-engineering/git-rebase-sync/SKILL.md`
- `git-worktree-tidy`: clean and repair Git worktrees — `$HOME/.pi/agent/skills/skill-library/software-engineering/git-worktree-tidy/SKILL.md`
- `create-agentsmd`: create repository AGENTS.md — `$HOME/.pi/agent/skills/skill-library/software-engineering/create-agentsmd/SKILL.md`
- `improve-codebase-architecture`: architecture improvement analysis — `$HOME/.pi/agent/skills/skill-library/software-engineering/improve-codebase-architecture/SKILL.md`
- `skill-vetter`: evaluate and vet skills — `$HOME/.pi/agent/skills/skill-library/software-engineering/skill-vetter/SKILL.md`
- `spec-best-practices`: write and review technical specifications — `$HOME/.pi/agent/skills/skill-library/software-engineering/spec-best-practices/SKILL.md`
- `to-prd`: turn ideas into product requirements — `$HOME/.pi/agent/skills/skill-library/software-engineering/to-prd/SKILL.md`
- `writing-prds`: write product requirement documents — `$HOME/.pi/agent/skills/skill-library/software-engineering/writing-prds/SKILL.md`
- `git-commit`: conventional commit generation and staging — `$HOME/.pi/agent/skills/skill-library/software-engineering/git-commit/SKILL.md`
- `writing-plans`: write implementation plans before multi-step work — `$HOME/.pi/agent/skills/skill-library/software-engineering/writing-plans/SKILL.md`


## Languages

- `golang-code-style`: Go style and linting — `$HOME/.pi/agent/skills/skill-library/languages/golang-code-style/SKILL.md`
- `golang-patterns`: idiomatic Go patterns and best practices — `$HOME/.pi/agent/skills/skill-library/languages/golang-patterns/SKILL.md`
- `golang-pro`: advanced Go development — `$HOME/.pi/agent/skills/skill-library/languages/golang-pro/SKILL.md`
- `python-code-style`: Python style, linting, and docstring conventions — `$HOME/.pi/agent/skills/skill-library/languages/python-code-style/SKILL.md`
- `python-design-patterns`: Python design patterns — `$HOME/.pi/agent/skills/skill-library/languages/python-design-patterns/SKILL.md`
- `rust-best-practices`: Rust engineering practices — `$HOME/.pi/agent/skills/skill-library/languages/rust-best-practices/SKILL.md`

## DevOps and platforms

- `devenv-migration`: migrate or create devenv projects — `$HOME/.pi/agent/skills/skill-library/devops/devenv/SKILL.md`
- `devops-engineer`: CI/CD, Kubernetes, Terraform, GitOps — `$HOME/.pi/agent/skills/skill-library/devops/devops-engineer/SKILL.md`
- `docker-expert`: Docker optimization, hardening, deployment — `$HOME/.pi/agent/skills/skill-library/devops/docker-expert/SKILL.md`
- `github-actions-docs`: GitHub Actions documentation — `$HOME/.pi/agent/skills/skill-library/devops/github-actions-docs/SKILL.md`
- `github-actions-templates`: GitHub Actions templates — `$HOME/.pi/agent/skills/skill-library/devops/github-actions-templates/SKILL.md`
- `multi-stage-dockerfile`: multi-stage Dockerfiles — `$HOME/.pi/agent/skills/skill-library/devops/multi-stage-dockerfile/SKILL.md`
- `nix-best-practices`: Nix flakes, overlays, shell.nix, flake.nix conventions — `$HOME/.pi/agent/skills/skill-library/devops/nix-best-practices/SKILL.md`
- `orbstack-best-practices`: OrbStack workflows — `$HOME/.pi/agent/skills/skill-library/devops/orbstack-best-practices/SKILL.md`

## Security

- `security-requirement-extraction`: extract security requirements — `$HOME/.pi/agent/skills/skill-library/security/security-requirement-extraction/SKILL.md`

## Testing

- `test-driven-development`: TDD workflow — `$HOME/.pi/agent/skills/skill-library/testing/test-driven-development/SKILL.md`
