# pi-ast-grep

`pi-ast-grep` is a Pi extension package that adds an `ast_grep` custom tool for syntax-aware structural search.

It wraps the official `@ast-grep/cli` binary instead of a text grep. This gives Pi a compact, read-only interface to `ast-grep run` and `ast-grep scan` across the languages supported by the ast-grep CLI.

## Features

- Registers one Pi tool: `ast_grep`.
- Supports ad-hoc structural search with `command: "run"` and `pattern` or `kind`.
- Supports rule/config scanning with `command: "scan"` and ast-grep YAML rules or `sgconfig.yml`.
- Uses argument arrays, not shell command strings.
- Strips accidental leading `@` from path-like inputs, matching common Pi file-reference behavior.
- Produces a concise match summary with one-based file locations.
- Truncates LLM-visible output to Pi's standard limits and writes full output to a temp file when truncated.
- Read-only in v0: no rewrite, interactive edit, or update-all mode is exposed.

## Installation

From npm, once published:

```bash
pi install npm:pi-ast-grep
```

From a local checkout:

```bash
cd pi-ast-grep
npm install
pi -e ./src/index.ts
```

Or install it as a local Pi package from a parent project:

```bash
pi install ./pi-ast-grep
```

## Tool parameters

| Parameter | Mode | Description |
| --- | --- | --- |
| `command` | both | `"run"` or `"scan"`. Defaults to `"run"`. |
| `pattern` | run | ast-grep pattern, for example `console.log($A)`. |
| `kind` | run | AST node kind, for example `call_expression`. Use instead of `pattern`. |
| `language` | run | Optional ast-grep language, for example `ts`, `tsx`, `js`, `python`, `rust`, `go`. |
| `paths` | both | Files/directories to search. Defaults to `["."]`. |
| `globs` | both | Include/exclude patterns passed as repeated `--globs` flags. |
| `config` | both | Optional `sgconfig.yml` path passed as top-level `--config`. |
| `rule` | scan | Rule YAML file path passed as `--rule`. |
| `inlineRules` | scan | Inline YAML passed as `--inline-rules`. |
| `selector` | run | Optional `--selector` AST kind. |
| `strictness` | run | `"cst"`, `"smart"`, `"ast"`, `"relaxed"`, or `"signature"`. |
| `context` | run | Context lines around each match. Mutually exclusive with `before`/`after`. |
| `before` / `after` | run | Lines before/after each match. |
| `json` | both | `"compact"` or `"stream"`. Defaults to `"compact"`. |
| `maxResults` | both | Maximum matches shown in the summary. Defaults to `200`. |
| `timeoutMs` | both | Subprocess timeout. Defaults to `30000`. |
| `includeRaw` | both | Append raw ast-grep JSON. Defaults to `false`. |

## Examples

Ask Pi to search TypeScript call sites structurally:

```text
Use ast_grep with pattern "console.log($A)", language "ts", and paths ["src"].
```

Equivalent tool input:

```json
{
  "command": "run",
  "pattern": "console.log($A)",
  "language": "ts",
  "paths": ["src"]
}
```

Search by AST kind:

```json
{
  "command": "run",
  "kind": "call_expression",
  "language": "ts",
  "paths": ["src"],
  "maxResults": 50
}
```

Scan with a rule file:

```json
{
  "command": "scan",
  "rule": "rules/no-console.yml",
  "paths": ["src"],
  "globs": ["*.ts", "!*.test.ts"]
}
```

Scan using project `sgconfig.yml` discovery:

```json
{
  "command": "scan",
  "paths": ["."]
}
```

## Blocking behavior

`ast_grep` is a normal Pi custom tool call:

- Pi waits for the ast-grep subprocess to finish before the tool result is finalized.
- The tool honors Pi cancellation through `AbortSignal` and also enforces `timeoutMs`.
- The extension does **not** register a permission gate or block other Pi tools.
- The extension is read-only; it does not apply rewrites or mutate repository files.

If you meant "blocking" as in a permission/safety gate, that is intentionally out of scope for v0. Pair this extension with a permission/sandbox package if you need enforcement around later edit/write/bash operations.

## Blockers and limitations

Known blockers for v0 are tracked in [`docs/BLOCKERS.md`](docs/BLOCKERS.md).

Important limitations:

- Native binary availability depends on `@ast-grep/cli` installing correctly for the user's platform.
- Very large result sets may hit the subprocess capture limit, Pi truncation, or `timeoutMs`.
- This tool intentionally does not expose ast-grep rewrite/apply flags.
- JSON output shape is owned by ast-grep CLI and may change across ast-grep versions; this package pins `@ast-grep/cli` to `0.43.0`.
- Language support and pattern syntax are exactly the ast-grep CLI behavior, not custom Pi behavior.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

Smoke-test the extension in Pi:

```bash
pi -e ./src/index.ts
```

Then ask Pi to use `ast_grep` against `test/fixtures` or another small project.

## Project structure

```text
pi-ast-grep/
  src/
    index.ts    # Pi extension entrypoint and tool registration
    schema.ts   # TypeBox schema, input normalization, validation
    cli.ts      # ast-grep binary resolution, argv construction, process execution
    output.ts   # JSON parsing, match summary, truncation, temp output files
  test/         # Node test runner tests
  docs/         # English project notes and blockers
```

## Security notes

The tool runs the bundled `ast-grep` binary with explicit argv arrays. It does not concatenate user input into a shell command. It is read-only by design, but it can still read files reachable from the Pi working directory and any paths supplied by the model.

Review third-party Pi packages before installing them. Pi extensions run with your user permissions.

## License

MIT
