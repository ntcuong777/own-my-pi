Custom Pi extensions live here. Auto-discovered from `~/.pi/agent/extensions/`.
Pi loads top-level `*.ts` plus each subdirectory's `index.ts`.

Tracked:

- `rtk.ts` — rewrite bash via `rtk` (binary must be on PATH)
- `exit-alias.ts` — `/exit` is an alias of builtin `/quit`
- `learn-mode.ts` — `/learn` read-only tutor mode (`--learn` flag)
- `personal-mode.ts` — `/personal on|off|status`. RAM overlay from
  `~/.pi/agent/personal.json`. Never writes `settings.json`. `pi-personal`
  (`PI_PERSONAL=1`) forces on for the process.
- `plan-toggle.ts` — Alt+Shift+P toggles `/plan` and keeps the editor draft.
  Do not also set `toggleShortcut` in pi-plan-mode settings.
- `skill-summon/` — typing `/` after prose or after `/skill:foo …` opens
  the skill completion popup (Pi only auto-opens at prompt start).
- `goal/` — `/goal` autonomous completion. `goal_complete` /
  `goal_blocked`. Continues on `agent_settled`. Optional
  `~/.pi/piex-dev/goal/goal.json`.
  From [piex-dev/piex](https://github.com/piex-dev/piex/tree/main/extensions/goal)
  (`5cd4467`, @piex-dev/goal 0.1.0, MIT, debugtalk).
- `plan-review-feedback.ts` — `/plan-refine` sends plan-revision notes.
  pi-plan-mode has Stay/Implement/Export, not OMP's Refine overlay.
- `redact-secrets.ts` — scrub secrets and PII from **local file/shell tool
  results** via [redactum](https://github.com/alexwhin/redactum) **defaults**
  (no custom `policies` / `categories` override). That includes emails,
  phones, SSNs, medical record numbers, insurance IDs, and named API keys.
  Skills (`cursor_activate_skill`, `SKILL.md`) are not redacted. The LLM
  context copy is not rewritten (Codex `encrypted_content` stays intact).
  Placeholders are unique per finding (`<redacted:ak1>` / `<redacted:ssn1>`),
  and an `edit`/`write` payload carrying one is restored to the real bytes
  before the tool runs — or blocked with `[E_REDACT_PLACEHOLDER]` when the
  token is unknown. Regex technical control, not a HIPAA/BAA determination.
  Not a sandbox.

Vendored from [rytswd/pi-agent-extensions](https://github.com/rytswd/pi-agent-extensions)
(`98b926f`). Imports rewritten `@mariozechner/*` → `@earendil-works/*`.

- `direnv/` — load allowed `.envrc` into `process.env`; reloads on direnv
  watch-file changes. Requires `direnv` on PATH.
- `permission-gate/` — `/gate` prompt/block for `rm -rf`, sudo, force-push,
  whole-tree scans, ssh remote commands, interpreter `-c`, crontab, and
  env-var launchers (`GIT_PAGER=…`). Tracks `cd` across `&&`/`;`, fetch-then-
  exec in the same command, echo/printf process substitutions, and more
  wrappers (`valgrind`, `strace`, `chroot`, …). `write`/`edit` of gate
  config or `PI_NO_GATE=` are gated too. Confirmation layer, not a sandbox.
  `PI_NO_GATE=1` disables. Default overlay:
  `agent/shared/permission-gate/rules.ts` live-linked to
  `~/.config/pi-agent-extensions/permission-gate/rules.ts`.
- `slow-mode/` — `/slow-mode` review gate for `write`/`edit` before disk.
  Optional `difft` / `delta`.
- `statusline/` — model, usage, context, VCS on one line. `/statusline`.
  Config/cache in `~/.config/pi-statusline/`.
- `stash/` — `Alt+S` session stash, `Alt+Shift+S` global stash.
- `notify/` — desktop ping when Pi is waiting. `/notify`.
- `inbox/` — `$PI_INBOX` unix socket so background jobs can wake the session.

Vendored from [rytswd/pi-agent-extensions-extra](https://github.com/rytswd/pi-agent-extensions-extra)
(`48cf021`):

- `telegram-connect/` — `/telegram` bridge. Direct polling works without
  extra deps. Multi-session topics need `pi-bridge` on PATH.

Do not `pi install` those repos as packages: they enable every extension
by default and would duplicate tools already in vendor/.

Coming: model-roles, spawn cwd lock, cwd-scope, web-permission.

Npm plugins are vendored under vendor/, not here.
