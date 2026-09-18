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

### Matt Pocock collection

- `matt/grill-me`: interrogate requirements — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/productivity/grill-me/SKILL.md`
- `matt/handoff`: prepare agent handoffs — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/productivity/handoff/SKILL.md`
- `matt/write-a-skill`: author a skill — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/productivity/write-a-skill/SKILL.md`
- `matt/caveman`: compress communication — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/productivity/caveman/SKILL.md`
- `matt/edit-article`: edit articles — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/personal/edit-article/SKILL.md`
- `matt/obsidian-vault`: work with Obsidian vaults — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/personal/obsidian-vault/SKILL.md`
- `matt/setup-pre-commit`: configure pre-commit — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/misc/setup-pre-commit/SKILL.md`
- `matt/scaffold-exercises`: scaffold exercises — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/misc/scaffold-exercises/SKILL.md`
- `matt/migrate-to-shoehorn`: migrate to Shoehorn — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/misc/migrate-to-shoehorn/SKILL.md`
- `matt/git-guardrails-claude-code`: Git guardrails — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/misc/git-guardrails-claude-code/SKILL.md`
- `matt/writing-shape`: shape writing — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/in-progress/writing-shape/SKILL.md`
- `matt/writing-fragments`: write concise fragments — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/in-progress/writing-fragments/SKILL.md`
- `matt/writing-beats`: structure writing beats — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/in-progress/writing-beats/SKILL.md`
- `matt/review`: review work — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/in-progress/review/SKILL.md`
- `matt/teach`: teach technical concepts — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/in-progress/teach/SKILL.md`
- `matt/triage`: triage engineering problems — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/triage/SKILL.md`
- `matt/to-prd`: create PRDs — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/to-prd/SKILL.md`
- `matt/to-issues`: create issues — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/to-issues/SKILL.md`
- `matt/tdd`: apply TDD — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/tdd/SKILL.md`
- `matt/prototype`: prototype solutions — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/prototype/SKILL.md`
- `matt/improve-codebase-architecture`: improve architecture — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/improve-codebase-architecture/SKILL.md`
- `matt/grill-with-docs`: reason with documentation — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/grill-with-docs/SKILL.md`
- `matt/diagnose`: diagnose problems — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/diagnose/SKILL.md`
- `matt/zoom-out`: widen problem context — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/zoom-out/SKILL.md`
- `matt/setup-matt-pocock-skills`: install collection — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/engineering/setup-matt-pocock-skills/SKILL.md`
- `matt/request-refactor-plan`: request refactor plans — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/deprecated/request-refactor-plan/SKILL.md`
- `matt/qa`: quality assurance — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/deprecated/qa/SKILL.md`
- `matt/design-an-interface`: design interfaces — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/deprecated/design-an-interface/SKILL.md`
- `matt/ubiquitous-language`: define ubiquitous language — `$HOME/.pi/agent/skills/skill-library/software-engineering/mattpocock-skills/skills/deprecated/ubiquitous-language/SKILL.md`

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

## Business and product

- `competitive-analysis`: competitor research — `$HOME/.pi/agent/skills/skill-library/business/competitive-analysis/SKILL.md`
- `startup-financial-modeling`: startup financial models — `$HOME/.pi/agent/skills/skill-library/business/startup-financial-modeling/SKILL.md`
- `startup-ideation`: startup ideation — `$HOME/.pi/agent/skills/skill-library/business/startup-ideation/SKILL.md`
- `startup-metrics-framework`: startup metrics — `$HOME/.pi/agent/skills/skill-library/business/startup-metrics-framework/SKILL.md`
- `startup-pivoting`: startup pivots — `$HOME/.pi/agent/skills/skill-library/business/startup-pivoting/SKILL.md`

## Emacs

- `emacsclient`: all Emacs operations through emacsclient — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/emacsclient/SKILL.md`
- `file-links`: format file references as links — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/file-links/SKILL.md`
- `select`: select Emacs skill — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/select/SKILL.md`
- `open`: open files in Emacs — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/open/SKILL.md`
- `plantuml`: create PlantUML diagrams — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/plantuml/SKILL.md`
- `highlight`: highlight Emacs regions — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/highlight/SKILL.md`
- `matplotlib`: plot with matplotlib — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/matplotlib/SKILL.md`
- `mermaid`: create Mermaid diagrams — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/mermaid/SKILL.md`
- `dired`: open files through Emacs dired — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/dired/SKILL.md`
- `gnuplot`: plot with gnuplot — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/gnuplot/SKILL.md`
- `describe`: look up Emacs documentation — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/describe/SKILL.md`
- `d2`: create D2 diagrams — `$HOME/.pi/agent/skills/skill-library/emacs/emacs-skills/skills/d2/SKILL.md`
