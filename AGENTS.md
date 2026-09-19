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
- skills/ Pi skills live-linked per directory into ~/.agents/skills/

## Skills

`skills/` is live-linked per directory into ~/.agents/skills, including
using-superpowers, dispatching-parallel-agents, and
finishing-a-development-branch. settings.json lists ~/.agents/skills first
(Pi's builtin default is ~/.pi/agent/skills, which this harness no longer
installs). Host settings.json also adds ~/.claude/skills and ~/.codex/skills.

## Keybindings

`~/.pi/agent/keybindings.json` is live-linked from `agent/shared/keybindings.json`.
Alt+Enter / M-RET inserts a newline (`tui.input.newLine`), matching Emacs.
Follow-up is `Ctrl+Alt+Enter` or `Alt+Shift+Enter`. Run `/reload` after
edits. Shift+Enter and Ctrl+J still insert a newline.

## Live edit

Home Manager points ~/.pi/agent/{settings,extensions,agents,vendor,keybindings.json} and
~/.agents/skills/<name> at this checkout via mkOutOfStoreSymlink. Edit
JSON, skills, custom extensions, or vendor/src and the next Pi start
sees it. No NixOS / nix-darwin rebuild.

vendor/node_modules is gitignored. First activation copies third-party deps
from `nix build .#plugins` and rewrites first-party names to vendor/src.
After that, replacing a plugin tree is enough. New npm deps still need a
rebuild or `npm install` in vendor/.

The Pi CLI is `nix build .#pi` / home.packages, pinned by flake input `pi`
(github:earendil-works/pi). Do not install @earendil-works/pi-coding-agent
via activation or `npm install -g`.

## File edits

Use the hashline `edit` tool. Never rewrite files with `python -c`,
`node -e`, `bun -e`, a python/node/bun heredoc, a one-off `*.py`/`*.js`/
`*.ts` patcher, `sed -i`, `perl -pi`, `cat > file <<EOF`, `tee`, or
`echo … > file`. Those skip hashline, slow-mode,
and undo. Writing a temp script and running it (`python3 /tmp/patch.py`,
`node /tmp/x.js`, `bun /tmp/x.ts`, `bash /tmp/x.sh`, `source x.sh`) is
the same bypass: the gate reads that file and prompts only if you
supply a rationale tied to the user's current request (`request_permission`
in Pi, or `# pi-gate-goal` / `# pi-gate-rationale` comments in Cursor
Shell). A gated command without that rationale never asks the user.
Test runners (`bun test`, `node --test`, `pytest`) are scanned the same
way. The prompt is Allow once, Always allow this exact command for the session (not every script; LRU cap 512; later runs still warn if they match a gate rule), or
Reject with a reason (pre-filled plus type-your-own). After 60s with no
answer a reminder fires; 5 minutes after that the prompt auto-rejects.
Both delays and the timeout default (reject vs allow) are configurable
in the overlay `prompt` block. If `edit` fails, re-read the file and
retry with fresh `LINE#HASH` anchors. `replace_text` is disabled
(`replaceText: false` in hashline.json). To find edit sites, use the
hashline `grep` tool (not shell `rg`/`grep`): matches come back as
`LINE#HASH:content` and can go straight into `edit`. Piped filters
(`cargo test | grep FAILED`) are fine. In Cursor, that tool is
`mcp_pi-agent_grep` when Pi builtins are hidden.

Cursor models inside Pi (`pi-cursor-sdk`) keep Cursor's own Read / Shell /
Write / StrReplace host tools. Pi's overlapping builtins (`read`, `bash`,
`write`, `edit`, …) are hidden from the Cursor bridge unless
`PI_CURSOR_EXPOSE_BUILTIN_TOOLS=1`. Cursor host Shell does not go through
permission-gate. Do not fall back to python, node, or bun scripts there
either: use Cursor StrReplace / Write, or the hashline `edit` MCP tool.

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
- vendor/src/pi-btw (dbachelder/pi-btw)
- vendor/src/pi-cursor-sdk (fitchmultz/pi-cursor-sdk)

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
