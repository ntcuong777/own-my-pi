# Pi harness guidelines

This repository is the Pi daily-driver harness. It does not depend on any host NixOS or nix-darwin checkout.

## What belongs here

- agent/** Pi settings, roles, MCP, agents, custom extensions
- vendor/src/ extracted plugin source trees
- vendor/package-lock.json third-party runtime deps only
- vendor/link-node-modules.sh first-party node_modules -> src links
- nix/home-module.nix Home Manager module (live out-of-store symlinks, Nix-store pi)
- nix/plugins.nix copies src trees and installs transitives (seed vendor/node_modules)
- nix/pi.nix wraps pinned @earendil-works/pi-coding-agent into the Nix store
- skills/ Pi skills live-linked to ~/.pi/agent/skills/

## Live edit

Home Manager points ~/.pi/agent/{settings,skills,extensions,agents,vendor} at this
checkout via mkOutOfStoreSymlink. Edit JSON, skills, custom extensions, or
vendor/src and the next Pi start sees it. No NixOS / nix-darwin rebuild.

vendor/node_modules is gitignored. First activation copies third-party deps
from `nix build .#plugins` and rewrites first-party names to vendor/src.
After that, replacing a plugin tree is enough. New npm deps still need a
rebuild or `npm install` in vendor/.

The Pi CLI is `nix build .#pi` / home.packages, pinned by flake input `pi`
(github:earendil-works/pi). Do not install @earendil-works/pi-coding-agent
via activation or `npm install -g`.

## Plugins

Do not use pi install npm: at runtime. Settings packages are local paths under
./vendor/node_modules/ (resolved against ~/.pi/agent, not the realpath of
settings.json). Those names are symlinks to vendor/src/.

Plugin source lives in vendor/src/, not tarballs. Git snapshots:
- vendor/src/pi-neuralwatt (aliou/pi-neuralwatt)
- vendor/src/pi-codex-account (fadilsflow/pi-codex-account)
- vendor/src/pi-subagents (nicobailon/pi-subagents)
- vendor/src/pi-memory (samfoy/pi-memory, @samfp/pi-memory)
- vendor/src/pi-review (earendil-works/pi-review, @earendil-works/pi-review)

vendor/src/pi-hashline-edit is a local fork of RimuruW 0.8.3, not a clean
snapshot. It carries guards ported from YuGiMob/pi-hashline-edit-pro while
keeping derived LINE#HASH anchors and the tool name `edit`: payload prefix
stripping, boundary dedup, whole-span freshness, a write echo guard,
auto-read after write, in-memory undo, an `insert` op, and
`/hashline-config`. Settings live in the tracked agent/shared/hashline.json
(anchor-only edits: replaceText is false). Re-syncing upstream means
re-applying these; see docs/superpowers/plans/2026-09-18-hashline-pro-steal.md
in the nix-darwin parent repo.

Custom spawn must enforce cwd; it must not create git worktrees. Plan
delegation uses pi-subagents, not a custom spawn hub.
