# Home Manager module for this Pi harness.
#
# Import via `inputs.own-my-pi.homeModules.default`.
# Fast-changing files are mkOutOfStoreSymlink into the live checkout at
# harnessRoot (fork/own-my-pi). Pi reads ~/.pi/agent; relative package
# paths resolve from that directory, not the realpath of settings.json.
# Extra args: isWorkstation, harnessRoot.
{ self, piSrc }:
{
  config,
  lib,
  pkgs,
  isWorkstation ? false,
  harnessRoot ? "",
  ...
}:

let
  host = if isWorkstation then "workstation" else "laptop";
  plugins = pkgs.callPackage ./plugins.nix { inherit self; };
  pi = pkgs.callPackage ./pi.nix { inherit piSrc; };
  mkLive = rel: config.lib.file.mkOutOfStoreSymlink "${harnessRoot}/${rel}";
  linker = "${harnessRoot}/vendor/link-node-modules.sh";
  homeDir = config.home.homeDirectory;
in
{
  assertions = [
    {
      assertion = harnessRoot != "";
      message = "own-my-pi home module needs harnessRoot (live fork/own-my-pi checkout).";
    }
  ];

  home.packages = [ pi ];

  home.file = {
    ".pi/agent/settings.json".source = mkLive "agent/${host}/settings.json";
    ".pi/agent/model-roles.json".source = mkLive "agent/${host}/model-roles.json";
    ".pi/agent/mcp.json".source = mkLive "agent/${host}/mcp.json";
    ".pi/agent/spawn.json".source = mkLive "agent/${host}/spawn.json";
    ".pi/agent/compaction.json".source = mkLive "agent/${host}/compaction.json";
    ".pi/agent/personal.json".source = mkLive "agent/shared/personal.json";
    ".pi/agent/hashline.json".source = mkLive "agent/shared/hashline.json";
    ".pi/agent/agents".source = mkLive "agent/agents";
    ".pi/agent/extensions".source = mkLive "agent/extensions";
    ".pi/agent/skills".source = mkLive "skills";
    ".pi/agent/vendor".source = mkLive "vendor";
    ".local/bin/pi-personal".source = mkLive "agent/bin/pi-personal";
  };

  # ~/.local/bin is prepended to PATH. A leftover npm launcher would hide
  # the Nix-store pi from home.packages.
  home.activation.unshadowLocalNpmPi = lib.hm.dag.entryBefore [ "linkGeneration" ] ''
    bin=${lib.escapeShellArg "${homeDir}/.local/bin/pi"}
    pkg=${lib.escapeShellArg "${homeDir}/.local/lib/node_modules/@earendil-works/pi-coding-agent"}
    if [ -e "$bin" ] || [ -L "$bin" ]; then
      echo "[own-my-pi] removing user-local npm pi so Nix-store pi is on PATH" >&2
      $DRY_RUN_CMD rm -f "$bin"
    fi
    if [ -e "$pkg" ]; then
      $DRY_RUN_CMD rm -rf "$pkg"
    fi
  '';

  # Seed gitignored vendor/node_modules from the plugins derivation once,
  # then keep first-party names pointed at live vendor/src.
  home.activation.linkOwnMyPiVendor = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    $DRY_RUN_CMD ${pkgs.bash}/bin/bash ${lib.escapeShellArg linker} \
      --vendor ${lib.escapeShellArg "${harnessRoot}/vendor"} \
      --store ${lib.escapeShellArg "${plugins}"}
  '';

  # Pi auto-loads ~/.agents/skills. Shared names belong in this harness.
  # Home Manager often leaves dropped ~/.agents/skills/<name> symlinks in a
  # pre-existing directory, which then show up as collisions.
  home.activation.pruneAgentsSkillCollisions = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    agentsSkills=${lib.escapeShellArg "${homeDir}/.agents/skills"}
    harnessSkills=${lib.escapeShellArg "${harnessRoot}/skills"}
    if [ -d "$agentsSkills" ] && [ -d "$harnessSkills" ]; then
      for skill in "$harnessSkills"/*; do
        [ -d "$skill" ] || continue
        name="$(basename "$skill")"
        path="$agentsSkills/$name"
        if [ -L "$path" ]; then
          echo "[own-my-pi] dropping leftover ~/.agents/skills/$name (harness owns this name)" >&2
          $DRY_RUN_CMD rm -f "$path"
        fi
      done
    fi
  '';
}
