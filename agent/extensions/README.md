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
- `redact-secrets.ts` — scrub secrets from tool results and the LLM context
  copy via [redactum](https://github.com/alexwhin/redactum) (API_KEY, AWS_KEY,
  PRIVATE_KEY, DATABASE_CREDENTIALS, DEV_SECRET). Not a sandbox.

Coming: model-roles, spawn cwd lock, cwd-scope, web-permission.

Npm plugins are vendored under vendor/, not here.
