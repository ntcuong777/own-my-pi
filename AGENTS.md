# Pi harness guidelines

This repository is the Pi daily-driver harness. It does not depend on any host NixOS or nix-darwin checkout.

## What belongs here

- agent/** Pi settings, roles, MCP, agents, custom extensions
- vendor/ plugin sources, first-party tarballs, and package-lock.json
- nix/home-module.nix Home Manager module
- nix/plugins.nix plugin install from the lockfile
- skills/ Pi skills linked to ~/.pi/agent/skills/

## Plugins

Do not use pi install npm: at runtime. Settings packages are local paths under ./vendor/node_modules/ (resolved against ~/.pi/agent/settings.json).

First-party plugin tarballs live in vendor/tarballs/. Git checkouts:
- vendor/src/pi-neuralwatt (aliou/pi-neuralwatt)
- vendor/src/pi-codex-account (fadilsflow/pi-codex-account)

Transitive npm deps are pinned in vendor/package-lock.json and installed by nix build .#plugins.

Custom spawn must enforce cwd; it must not create git worktrees.
