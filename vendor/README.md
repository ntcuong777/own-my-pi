# Vendored Pi plugins

Runtime Pi does not hit the npm registry.

- src/pi-neuralwatt and src/pi-codex-account are git snapshots
- tarballs/ holds first-party npm plugin tarballs
- package-lock.json pins the full install graph

Home Manager links nix build .#plugins to ~/.pi/agent/vendor
