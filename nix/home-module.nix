# Home Manager module for this Pi harness.
#
# Nix-darwin imports this via `inputs.pi-harness.homeModules.default`.
# Config files are out-of-store symlinks into the live checkout
# (`${repoRoot}/fork/pi-harness`) so edits apply without a rebuild.
# `self` is used to read packages.json from the flake; live links still
# point at the submodule checkout, not the Nix store.
#
# Required extra args (already set by nix-darwin home.nix):
#   repoRoot, isWorkstation, userhome
{ self }:
{
  config,
  lib,
  pkgs,
  userhome,
  isWorkstation ? false,
  repoRoot,
  ...
}:

let
  src = "${repoRoot}/fork/pi-harness";
  host = if isWorkstation then "workstation" else "laptop";
  packagesJson = builtins.fromJSON (builtins.readFile (self + "/packages.json"));
  npmPackages = packagesJson.npm;

  mkLink = target: source: {
    name = target;
    value.source = config.lib.file.mkOutOfStoreSymlink "${src}/${source}";
  };

  extensionFiles = [
    "rtk.ts"
  ];

  links = [
    (mkLink ".pi/agent/settings.json" "agent/${host}/settings.json")
    (mkLink ".pi/agent/model-roles.json" "agent/${host}/model-roles.json")
    (mkLink ".pi/agent/mcp.json" "agent/${host}/mcp.json")
    (mkLink ".pi/agent/spawn.json" "agent/${host}/spawn.json")
    (mkLink ".pi/agent/compaction.json" "agent/${host}/compaction.json")
    (mkLink ".pi/agent/personal.json" "agent/shared/personal.json")
    (mkLink ".pi/agent/agents" "agent/agents")
    (mkLink ".local/bin/pi-personal" "agent/bin/pi-personal")
  ]
  ++ map (name: mkLink ".pi/agent/extensions/${name}" "agent/extensions/${name}") extensionFiles;

  activationPath = lib.makeBinPath [
    pkgs.coreutils
    pkgs.jq
  ];
  install = lib.getExe' pkgs.coreutils "install";
  ln = lib.getExe' pkgs.coreutils "ln";
in
{
  home.file = lib.listToAttrs links;

  home.activation.piHarnessPackages = lib.hm.dag.entryAfter [ "aiCliBootstrap" "writeBoundary" ] ''
    set -euo pipefail
    export HOME="${userhome}"
    export PATH="${userhome}/.local/bin:${activationPath}:$PATH"
    BIN_DIR="${userhome}/.local/bin"

    if [ ! -x "$BIN_DIR/pi" ]; then
      echo "[pi-harness] Pi agent not installed; skip package install." >&2
    else
      PI_NODE_MODULES="${userhome}/.pi/agent/npm/node_modules"
      PI_PACKAGES=(
    ${lib.concatMapStrings (pkg: "        ${lib.escapeShellArg pkg}\n") npmPackages}
      )

      all_installed=true
      for pkg in "''${PI_PACKAGES[@]}"; do
        if [ ! -d "$PI_NODE_MODULES/$pkg" ]; then
          all_installed=false
          break
        fi
      done

      if $all_installed; then
        echo "[pi-harness] All Pi packages already installed; skip." >&2
      else
        echo "[pi-harness] Installing Pi packages..." >&2
        for pkg in "''${PI_PACKAGES[@]}"; do
          echo "[pi-harness] pi install npm:$pkg" >&2
          "$BIN_DIR/pi" install "npm:$pkg"
        done
      fi
    fi
  '';

  home.activation.piHarnessVendorPlugins = lib.hm.dag.entryAfter [ "aiCliBootstrap" ] ''
    set -euo pipefail
    export HOME="${userhome}"
    ext_dir="${userhome}/.pi/agent/extensions"
    ${install} -dm755 "$ext_dir"
    neuralwatt_vendor="${repoRoot}/home/agent-configs/omp/agent/extensions/pi-neuralwatt"
    codex_vendor="${repoRoot}/home/agent-configs/omp/agent/extensions/omp-codex-account"
    if [ -f "$neuralwatt_vendor/package.json" ]; then
      ${ln} -sfn "$neuralwatt_vendor" "$ext_dir/pi-neuralwatt"
    fi
    if [ -f "$codex_vendor/package.json" ]; then
      ${ln} -sfn "$codex_vendor" "$ext_dir/omp-codex-account"
    fi
  '';
}
