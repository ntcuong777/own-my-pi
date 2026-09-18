Custom Pi extensions live here. Auto-discovered from `~/.pi/agent/extensions/`.

Tracked:

- `rtk.ts` — rewrite bash via `rtk` (binary must be on PATH)
- `exit-alias.ts` — `/exit` is an alias of builtin `/quit`
- `redact-secrets.ts` — scrub high-confidence secrets from tool results
  and the LLM context copy (PEM, cloud tokens, `password=` / `api_key=`
  assignments, URL userinfo). Not a sandbox.

Coming: model-roles, personal-mode, spawn cwd lock, cwd-scope, web-permission, learn-mode.

Npm plugins are vendored under vendor/, not here.
