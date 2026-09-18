# Pi harness

Personal harness for raw Pi.

Owns settings, vendored plugins, custom extensions, agents, and skills.

Plugin source lives in vendor/src/ (extracted trees, no tarballs). Nix installs third-party runtime deps and symlinks package names to those trees. Settings packages are local paths. No pi install npm at runtime.

Git snapshots: aliou/pi-neuralwatt, fadilsflow/pi-codex-account, nicobailon/pi-subagents.
Extracted npm plugins: juicesharp rpiv-*, pi-mcp-adapter, pi-hashline-edit, pi-smart-compact, pi-lens, pi-ast-grep, pi-antiloop, narumitw/pi-plan-mode.

Plan delegation: pi-subagents. Cheap default models live in settings.json under subagents.defaultModel.

Home Manager: imports = [ inputs.own-my-pi.homeModules.default ]; extra args userhome and isWorkstation.
Build plugins: nix build .#plugins
