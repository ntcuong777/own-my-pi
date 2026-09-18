Patch a text file at `LINE#HASH` anchors copied verbatim from the latest read/grep result or the anchors block of a previous edit.

Batch every change to a file into one `edit` call: all operations go in the `edits` array, every edit sets `op`, and all anchors must come from the same pre-edit read. Edits validate against one snapshot and apply together, so line numbers never shift between entries of the same call.

Ops:
- `replace` — replace the single line at `pos`, or the inclusive span `pos`..`end`. `lines` is the complete new content for the whole span; `lines: []` deletes it. Without `end`, exactly one line is replaced no matter how many entries `lines` has.
- `append` — insert `lines` after `pos`; omit `pos` to append at end of file.
- `prepend` — insert `lines` before `pos`; omit `pos` to insert at start of file.
- `insert` — `{ "op": "insert", "pos": ..., "direction": "before"|"after", "lines": [...] }` inserts without removing anything. Sugar for `prepend`/`append`.
- `replace_text` — `{ "op": "replace_text", "oldText": ..., "newText": ... }` replaces one exact, unique occurrence and fails otherwise. Prefer anchors; use this only when uniqueness is certain. `oldText`/`newText` are invalid on any other op.

Example — single-line and span replace in one call:
```json
{ "path": "src/main.ts", "edits": [
  { "op": "replace", "pos": "12#MQ", "lines": ["const x = 1;"] },
  { "op": "replace", "pos": "5#VR", "end": "8#QV", "lines": [
    "function greet(name) {",
    "  return `Hello, ${name}`;",
    "}"
  ] }
] }
```

Rules:
- `lines` is literal file content with exact indentation. A pasted `LINE#HASH:` or diff `+`/`-` prefix is stripped with a warning, and a replacement line that merely repeats the surviving neighbor line is dropped — but send literal content: nested rendered rows are rejected with `[E_INVALID_PATCH]`.
- A range replace validates every line between `pos` and `end`, not just the endpoints. If the interior changed since your last read, the edit is refused with `[E_STALE_SPAN]` and nothing is written.
- Never copy `LINE#HASH:` rows into the `write` tool; that is refused with `[E_WRITE_HASH_ECHO]`.
- `undo_last_change` reverts the most recent hashline edit to a file. One shot, in-memory, does not survive a restart.
- Anchors are opaque: copy them exactly, never compute, shift, or guess one.
- An anchor may keep the `:content` suffix from read output (`"12#MQ: const x = 1;"`). The runtime cross-checks that content against the file — catching hash collisions and recovering whitespace-only drift — so keep it for high-risk anchors such as range endpoints. Copy the content as rendered; if you shorten it, keep the start of the line and mark the cut with `...`.
- Edits in one call must not overlap or touch adjacent lines — merge such changes into a single edit.
