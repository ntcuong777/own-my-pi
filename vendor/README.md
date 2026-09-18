# Vendored Pi plugins

Runtime Pi does not hit the npm registry. Plugin code is extracted source under src/, not tarballs.

- src/ holds plugin trees (npm packages unpacked, plus git snapshots)
- sources.json maps package name to src path and origin
- package-lock.json pins third-party runtime deps only

`nix build .#plugins` copies src/, installs transitives into node_modules, and symlinks first-party package names to src/. Home Manager links that output to ~/.pi/agent/vendor.

Git snapshots include nicobailon/pi-subagents for plan delegation to cheap child agents.
