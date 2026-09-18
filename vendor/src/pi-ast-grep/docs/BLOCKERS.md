# Blockers and Limitations

This document records the known blockers and non-goals for `pi-ast-grep` v0.

## Current blockers

1. **Rewrite/apply mode is not implemented**
   - ast-grep can rewrite code, but `pi-ast-grep` v0 is intentionally read-only.
   - A future rewrite tool should use Pi's file mutation queue and should probably require explicit user approval.

2. **Native binary installation is delegated to `@ast-grep/cli`**
   - The package depends on `@ast-grep/cli@0.43.0`.
   - Installation can fail on unsupported platforms or when npm lifecycle scripts/native optional dependencies are blocked.
   - Workaround: install `ast-grep` on `PATH` and the extension will fall back to the `ast-grep` command.

3. **Large result sets are bounded**
   - The subprocess output capture limit is 64 MiB.
   - The LLM-visible output is truncated to Pi defaults: 2000 lines or 50 KiB.
   - Use narrower `paths`, `globs`, `language`, or `maxResults` values for large repositories.

4. **The CLI JSON schema is external**
   - Result parsing depends on ast-grep CLI JSON output.
   - The dependency is pinned to reduce accidental shape drift.

5. **No custom language registration**
   - `pi-ast-grep` uses the CLI language support only.
   - It does not expose `@ast-grep/napi` dynamic language registration.

## Not blockers

- **Blocking execution:** the tool already behaves as a normal blocking Pi tool call; Pi awaits the subprocess result.
- **Cancellation:** the tool accepts Pi's `AbortSignal` and has a timeout.
- **Shell injection:** the tool builds argv arrays and does not invoke a shell.

## Future work

- Add a separate, explicitly named `ast_grep_rewrite_preview` tool that only previews rewrites.
- Add a mutation-safe `ast_grep_apply` tool after designing approval and queue semantics.
- Add richer result rendering for the Pi TUI.
- Add config discovery helpers for common `sgconfig.yml` layouts.
