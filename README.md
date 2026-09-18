# Pi harness

Personal harness for raw Pi.

Owns settings, vendored plugins, custom extensions, agents, and skills.

Plugins live in vendor/ and are installed by Nix from package-lock.json. Settings packages are local paths. No pi install npm at runtime.

Vendored git plugins: aliou/pi-neuralwatt, fadilsflow/pi-codex-account.
Vendored npm plugins: juicesharp rpiv-web-tools, rpiv-ask-user-question, rpiv-todo, pi-mcp-adapter, pi-hashline-edit, pi-smart-compact, pi-lens, pi-ast-grep, pi-antiloop, narumitw/pi-plan-mode.

Home Manager: imports = [ inputs.own-my-pi.homeModules.default ]; extra args userhome and isWorkstation.
Build plugins: nix build .#plugins
