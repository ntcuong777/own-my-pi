#!/usr/bin/env bash
# Link first-party plugin names in vendor/node_modules to vendor/src.
# Keep this list in sync with nix/plugins.nix.
#
# Usage:
#   link-node-modules.sh --vendor /path/to/vendor [--store /nix/store/...-own-my-pi-plugins]
#
# --store copies third-party node_modules from a plugins derivation when
# vendor/node_modules/typebox is missing. First-party entries are always
# rewritten to relative src/ links so plugin edits are live.
set -euo pipefail

vendor=""
store=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --vendor)
      vendor="$2"
      shift 2
      ;;
    --store)
      store="$2"
      shift 2
      ;;
    *)
      echo "usage: $0 --vendor DIR [--store PLUGINS_OUT]" >&2
      exit 2
      ;;
  esac
done

if [ -z "$vendor" ]; then
  echo "usage: $0 --vendor DIR [--store PLUGINS_OUT]" >&2
  exit 2
fi

vendor="$(cd "$vendor" && pwd)"
cd "$vendor"

mkdir -p node_modules/@aliou node_modules/@juicesharp node_modules/@narumitw

if [ -n "$store" ] && [ -d "$store/node_modules" ] && [ ! -e node_modules/typebox ]; then
  echo "own-my-pi: seeding vendor/node_modules from $store"
  cp -a "$store/node_modules/." node_modules/
  # Store files are 0444; first-party rewrites below need a writable tree.
  chmod -R u+w node_modules
fi

if [ -d node_modules ]; then
  chmod -R u+w node_modules 2>/dev/null || true
fi

link_pkg() {
  pkg="$1"
  src="$2"
  case "$pkg" in
    */*)
      dest="node_modules/$pkg"
      mkdir -p "$(dirname "$dest")"
      ln -sfn "../../$src" "$dest"
      ;;
    *)
      ln -sfn "../$src" "node_modules/$pkg"
      ;;
  esac
}

link_pkg "@aliou/pi-neuralwatt" "src/pi-neuralwatt"
link_pkg "@aliou/pi-utils-settings" "src/pi-utils-settings"
link_pkg "@aliou/pi-utils-ui" "src/pi-utils-ui"
link_pkg "@juicesharp/rpiv-ask-user-question" "src/rpiv-ask-user-question"
link_pkg "@juicesharp/rpiv-config" "src/rpiv-config"
link_pkg "@juicesharp/rpiv-i18n" "src/rpiv-i18n"
link_pkg "@juicesharp/rpiv-todo" "src/rpiv-todo"
link_pkg "@juicesharp/rpiv-web-tools" "src/rpiv-web-tools"
link_pkg "@narumitw/pi-plan-mode" "src/pi-plan-mode"
link_pkg "@narumitw/pi-tui-kit" "src/pi-tui-kit"
link_pkg "pi-antiloop" "src/pi-antiloop"
link_pkg "pi-ast-grep" "src/pi-ast-grep"
link_pkg "pi-codex-account" "src/pi-codex-account"
link_pkg "pi-hashline-edit" "src/pi-hashline-edit"
link_pkg "pi-lens" "src/pi-lens"
link_pkg "pi-mcp-adapter" "src/pi-mcp-adapter"
link_pkg "pi-smart-compact" "src/pi-smart-compact"
link_pkg "pi-subagents" "src/pi-subagents"

mkdir -p src/pi-subagents/node_modules
if [ -e node_modules/undici-v8 ]; then
  ln -sfn ../../../node_modules/undici-v8 src/pi-subagents/node_modules/undici
fi

if [ ! -e node_modules/typebox ]; then
  echo "own-my-pi: vendor/node_modules missing third-party deps (typebox). Run a Nix rebuild or npm install in vendor/." >&2
  exit 1
fi
