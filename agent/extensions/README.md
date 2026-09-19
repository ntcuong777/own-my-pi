Custom Pi extensions live here. Auto-discovered from `~/.pi/agent/extensions/`.

Tracked:

- `rtk.ts` — rewrite bash via `rtk` (binary must be on PATH)
- `exit-alias.ts` — `/exit` is an alias of builtin `/quit`
- `learn-mode.ts` — `/learn` read-only tutor mode (`--learn` flag)
- `personal-mode.ts` — `/personal on|off|status`. RAM overlay from
  `~/.pi/agent/personal.json`. Never writes `settings.json`. `pi-personal`
  (`PI_PERSONAL=1`) forces on for the process.
- `plan-toggle.ts` — Alt+Shift+P toggles `/plan` and keeps the editor draft.
  Do not also set `toggleShortcut` in pi-plan-mode settings.
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

Coming: model-roles, spawn cwd lock, cwd-scope, web-permission.

Npm plugins are vendored under vendor/, not here.
