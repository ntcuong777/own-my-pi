# Pi harness guidelines

This repository is the Pi daily-driver harness. Do not put Home Manager
modules for Darwin/NixOS system config here. Those stay in nix-darwin.

## What belongs here

- `agent/**` Pi settings, roles, MCP, agents, custom extensions
- `packages.json` npm plugin list
- `nix/home-module.nix` the only Nix that this repo exports
- `skills/` Pi-only skills

## What stays in nix-darwin

- `pi` CLI install
- OMP fallback (`home/agent-configs/omp/`)
- vendored Neuralwatt / Codex-account trees (linked into `~/.pi/agent/extensions/` by the home module)

## Plugins first

Install an existing `pi install npm:` package before writing an extension.
Custom spawn must enforce cwd; it must not create git worktrees.
