# Hashline Pro-Steal Design

**Date:** 2026-09-18
**Status:** Approved for planning (decisions locked)
**Scope:** Steal selected YuGiMob `pi-hashline-edit-pro` guards and UX into vendored RimuruW `pi-hashline-edit` v0.8.3, plus redact-aware extras in `redact-secrets.ts`. Work lives in an isolated `fork/own-my-pi` git worktree for a later review agent.

## Problem

Hashline already targets by `LINE#HASH` of **disk** (xxh32 of prev/curr/next). That is the right identity model: models are trained on the `edit` tool, and derived hashes stay stable across sessions so prompt cache still hits.

What is missing is the pro plugin's **fail-closed guards** around that identity:

1. `replace_text` is still on (no `hashline.json`), so unique-string replace can hit the wrong secret after redaction collapses two values to one token.
2. Builtin `write` can echo `LINE#HASH:` / `+N#HH:` / diff-minus rows into the file.
3. Edit `lines` that copy display prefixes are rejected wholesale instead of stripped then applied.
4. Boundary duplication is a warning, not strip/strict.
5. Range replace validates **endpoints only**; a middle-of-span drift keeps both hashes and still applies.
6. After builtin `write`, the model has no fresh anchors until an extra `read`.
7. Shared `<redacted>` in `redact-secrets.ts` makes two secrets look identical to the model. Hashline hashes disk, but the model can still paste the placeholder into `lines`.

## Goal

Keep derived hashes and the tool name `edit`. Steal pro's guards/UX into the vendored plugin. Unique redaction tokens restore to disk bytes on apply and refuse leftover placeholders. Track `agent/shared/hashline.json` and live-link it to `~/.pi/agent/hashline.json`.

## Non-goals

- Do not switch to pro's allocated 4-letter identity model.
- Do not hide or rename the `edit` tool. Do not add a sibling `replace` tool.
- Do not add SQLite, `~/.config/pi-hashline-edit-pro/`, or full-file undo across restarts.
- Do not vendor `pi-hashline-edit-pro` as a second plugin.
- Do not commit unless the user asks.
- Do not drop uncommitted prior ports (`personal-mode`, `learn-mode`, plan extensions, redactum vendor). They come along in the worktree.

## Locked decisions

1. **Identity:** derived `LINE#HASH` (current xxh32). `hashLength` stays 2 unless the TUI changes it.
2. **Tool name:** `edit`. Insert is `op:"insert"` on that same tool, not a new tool.
3. **Config file:** tracked `fork/own-my-pi/agent/shared/hashline.json`, live-symlinked to `~/.pi/agent/hashline.json` (plugin already reads `join(getAgentDir(), "hashline.json")`).
4. **Tracked defaults:**
   ```json
   {
     "hashLength": 2,
     "grep": true,
     "replaceText": false,
     "boundaryDedup": "on"
   }
   ```
   `boundaryDedup`: `"off"` (no check) | `"on"` (strip duplicated boundary lines when at least one non-dup line remains) | `"strict"` (throw `[E_BOUNDARY_DUP]`). Plugin default without a file stays today's warn-only behavior.
5. **Write echo:** shape-based. Block builtin `write` if any content line matches `LINE#HASH:` / `+N#HH:` / diff-minus. Error `[E_WRITE_HASH_ECHO]`. No session-allocated id set.
6. **Display prefixes in `lines`:** strip once, then apply. If any line still looks like a display row, fail closed `[E_INVALID_PATCH]`.
7. **Whole-span freshness:** for `replace` with `pos`+`end`, after endpoint hashes match, compare live disk lines in `[pos, end]` to the same range in hashline's last unredacted `getReadSnapshot`. Mismatch → `[E_STALE_SPAN]`. No snapshot → skip this check (endpoint hashes still required).
8. **Auto-read after `write`:** on successful builtin `write` `tool_result`, snapshot the new bytes and append a hashline-formatted preview so the model can edit without a separate `read`.
9. **Undo:** in-memory one-shot only. New tool `undo_last_change` (optional `path`). Restores the pre-edit bytes of the last successful hashline `edit`. Cleared after use. No SQLite.
10. **Insert:** `{ "op": "insert", "pos": "<anchor>", "direction": "before"|"after", "lines": [...] }`. Normalize to `prepend` / `append` before apply so `apply.ts` stays on three ops plus `replace_text`.
11. **`/hashline-config`:** `ctx.ui.select` TUI. Persist JSON, `reloadConfig()`, re-register `edit` (and `grep` if enabled). No Overlay class.
12. **Redact extras:** unique tokens `<redacted:akN>` (and `aws`/`pk`/`db`/`ds`). Hash/match stays on disk (hashline unchanged). `tool_call` mutates `event.input` in place to restore secrets. Leftover placeholder → block `[E_REDACT_PLACEHOLDER]`. PII categories stay off.
13. **Worktree:** `fork/own-my-pi/.worktrees/feat-hashline-pro-steal` on branch `feat/hashline-pro-steal`. Add `.worktrees/` to the submodule `.gitignore`. Prior uncommitted own-my-pi WIP is applied in the worktree, not left only on `main`.

## Architecture

```
~/.pi/agent/hashline.json  →  agent/shared/hashline.json
pi-hashline-edit (vendor/src)
  config.ts          + boundaryDedup, reloadConfig, persist helpers
  hashline/parse.ts  strip display prefixes; insert op
  hashline/apply.ts  boundaryDedup on/off/strict
  edit.ts            insert schema; span freshness; remember undo
  write-hook.ts      [E_WRITE_HASH_ECHO] + auto-read on write result
  undo.ts            in-memory one-shot
  index.ts           register write hook, undo tool, /hashline-config
redact-secrets.ts    unique tokens + restore/refuse on tool_call
```

Hashline continues to hash **file bytes**. Redaction only changes what the model sees. Restore happens before hashline execute (`event.input` is mutable).

## Error codes

| Code | When |
|---|---|
| `[E_WRITE_HASH_ECHO]` | `write` content contains a display-prefix / diff-minus row |
| `[E_INVALID_PATCH]` | leftover display prefix after one strip pass |
| `[E_BOUNDARY_DUP]` | `boundaryDedup: "strict"` and replacement duplicates a surviving neighbor |
| `[E_STALE_SPAN]` | range replace endpoints match but interior ≠ last hashline snapshot |
| `[E_REPLACE_TEXT_DISABLED]` | already exists; now the live default via json |
| `[E_REDACT_PLACEHOLDER]` | edit/write payload still contains `<redacted` after restore |
| `[E_NO_UNDO]` | `undo_last_change` with nothing stored / path mismatch |

## Tests

bun:test under `fork/own-my-pi/tests/` (not live-linked into `~/.pi/agent`). Import plugin internals from `vendor/src/pi-hashline-edit/src/...`. Do not add vitest to the harness.

The plugin imports `@earendil-works/pi-coding-agent` (`getAgentDir` in `config.ts`; `createReadTool` / `formatSize` / `DEFAULT_MAX_*` / `truncateHead` in `read.ts`), which exists only inside the Nix-store `pi` derivation. Tests therefore run under a `bunfig.toml` preload (`tests/setup.ts`) that stubs that module, plus a gitignored `vendor/node_modules` symlink to the parent checkout for `@sinclair/typebox`, `diff`, `xxhashjs`, and `file-type`. Real anchors in tests come from `computeLineHash`, never hardcoded.
