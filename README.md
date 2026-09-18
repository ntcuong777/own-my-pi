# Pi harness

Personal harness for raw Pi.

Owns settings, vendored plugins, custom extensions, agents, and skills.

Home Manager live-symlinks this checkout into ~/.pi/agent. Edit settings,
skills, extensions, or vendor/src without a NixOS / nix-darwin rebuild.

Plugin source lives in vendor/src/ (extracted trees, no tarballs). Nix
installs third-party runtime deps once into gitignored vendor/node_modules
and symlinks package names to those trees. Settings packages are local
paths. No pi install npm at runtime.

Git snapshots: aliou/pi-neuralwatt, fadilsflow/pi-codex-account,
nicobailon/pi-subagents, samfoy/pi-memory, earendil-works/pi-review.
Extracted npm plugins: juicesharp rpiv-*, pi-mcp-adapter, pi-hashline-edit,
pi-smart-compact, pi-lens, pi-ast-grep, pi-antiloop, narumitw/pi-plan-mode.

Plan delegation: pi-subagents. Cheap default models live in settings.json
under subagents.defaultModel.

GitHub PR review: pi-review (`/review pr 123` checks out via `gh`).

The `pi` binary is a Nix-store package (`nix build .#pi`), not `npm install`
into ~/.local. Flake input `pi` pins github:earendil-works/pi; the derivation
wraps the matching published @earendil-works/pi-coding-agent tarball (prebuilt
dist + npm-shrinkwrap). Home Manager puts it on PATH and removes a leftover
~/.local/bin/pi so the user-local prefix cannot shadow it.

Home Manager: imports = [ inputs.own-my-pi.homeModules.default ]; extra args
userhome, isWorkstation, harnessRoot.
Build: nix build .#pi ; nix build .#plugins
