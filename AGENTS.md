# Pi harness guidelines

This repository is the Pi daily-driver harness. It does not depend on any host NixOS or nix-darwin checkout.

## What belongs here

- agent/** Pi settings, roles, MCP, agents, custom extensions
- vendor/src/ extracted plugin source trees
- vendor/package-lock.json third-party runtime deps only
- nix/home-module.nix Home Manager module
- nix/plugins.nix copies src trees and installs transitives
- skills/ Pi skills linked to ~/.pi/agent/skills/

## Plugins

Do not use pi install npm: at runtime. Settings packages are local paths under ./vendor/node_modules/ (resolved against ~/.pi/agent/settings.json). Those names are symlinks to vendor/src/.

Plugin source lives in vendor/src/, not tarballs. Git snapshots:
- vendor/src/pi-neuralwatt (aliou/pi-neuralwatt)
- vendor/src/pi-codex-account (fadilsflow/pi-codex-account)
- vendor/src/pi-subagents (nicobailon/pi-subagents)

Third-party runtime deps are pinned in vendor/package-lock.json and installed by nix build .#plugins.

Custom spawn must enforce cwd; it must not create git worktrees. Plan delegation uses pi-subagents, not a custom spawn hub.
