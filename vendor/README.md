# Vendored Pi plugins

Runtime Pi does not hit the npm registry. Plugin code is extracted source
under src/, not tarballs.

- src/ holds plugin trees (npm packages unpacked, plus git snapshots)
- sources.json maps package name to src path and origin
- package-lock.json pins third-party runtime deps only
- link-node-modules.sh points package names at src/ (and seeds node_modules
  from a plugins store output when typebox is missing)

`nix build .#plugins` copies src/, installs transitives into node_modules,
and runs link-node-modules.sh. Home Manager live-symlinks this vendor
directory to ~/.pi/agent/vendor. node_modules stays gitignored.

Git snapshots include nicobailon/pi-subagents for plan delegation to cheap
child agents, samfoy/pi-memory (@samfp/pi-memory) for cross-session
preferences and lessons, earendil-works/pi-review for `/review` /
`/end-review` including GitHub PRs via `gh pr checkout`, and
dbachelder/pi-btw for `/btw` parallel side conversations. Default Anthropic
consolidation model is a no-op on this stack; host settings.json sets
memory.consolidationModel.
