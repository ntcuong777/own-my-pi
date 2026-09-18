# Pi harness

Personal harness for raw Pi (`@earendil-works/pi-coding-agent`).

This repo owns Pi **settings, plugins, custom extensions, agents, and skills**.
nix-darwin (`ntcuong777/nix-conf`) only:

- installs the `pi` binary (`home/activation/ai-cli-bootstrap.nix`)
- imports `homeModules.default` from this flake
- keeps OMP as fallback under `home/agent-configs/omp/`

Checkout lives at `fork/pi-harness` inside nix-darwin (git submodule).

## Daily driver

`pi` is the daily driver. `omp` stays installed until an explicit removal.

Personal overlay: `pi-personal` or `/personal` (custom extension, not yet ported).
Never writes company `settings.json`.

## Plugin policy

Prefer an existing Pi package over a custom rebuild.

| Need | Package |
|---|---|
| Hashline edit (strict, no fuzzy) | `pi-hashline-edit` |
| Compact + secret scrub | `pi-smart-compact` |
| LSP / diagnostics | `pi-lens` (`@juicesharp/rpiv-lsp` does not exist) |
| Structural search | `pi-ast-grep` (search only) |
| Loop break | `pi-antiloop` |
| Plan TUI | `@narumitw/pi-plan-mode` |
| MCP | `pi-mcp-adapter` |
| Ask / todo / web | juicesharp `rpiv-*` already in use |
| Shell minimizer | `rtk.ts` + `rtk` binary from nix-darwin |

Keep custom only when no plugin matches: `/personal`, spawn **cwd lock** (plugins create worktrees; we refuse parent-tree writes), web session gate, `/learn` tutor.

OMP fallback still covers: fuzzy hashline, compaction cascade, `ast_edit`, TTSR.

## Layout

```
agent/laptop/          host settings, roles, MCP, spawn, compaction
agent/workstation/     same for workstation
agent/shared/          personal.json
agent/agents/          task.md, reviewer.md
agent/extensions/      custom TypeScript (rtk.ts today)
agent/bin/pi-personal  PI_PERSONAL=1 exec pi
packages.json          npm packages Home Manager installs
nix/home-module.nix    Home Manager module
skills/                Pi-only skills (optional)
```

## Nix wiring

nix-darwin flake input:

```nix
pi-harness.url = "path:./fork/pi-harness";
```

Home Manager:

```nix
imports = [ inputs.pi-harness.homeModules.default ];
```

Links are out-of-store into this checkout. Edit, save, next `pi` start sees it.
Package list changes still need `darwin-rebuild switch` (activation installs npm packages).

## Submodule workflow

From nix-darwin:

```bash
cd fork/pi-harness
# edit, commit, push origin main
cd /etc/nix-darwin
git add fork/pi-harness
git commit -m "chore(pi-harness): bump submodule"
```
