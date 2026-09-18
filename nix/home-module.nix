# Home Manager module for this Pi harness.
#
# Import via `inputs.own-my-pi.homeModules.default`.
# Fast-changing files are mkOutOfStoreSymlink into the live checkout at
# harnessRoot (fork/own-my-pi). Pi reads ~/.pi/agent; relative package
# paths resolve from that directory, not the realpath of settings.json.
# Extra args: isWorkstation, harnessRoot.
{ self }:
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
  mkLive = rel: config.lib.file.mkOutOfStoreSymlink "${harnessRoot}/${rel}";
  linker = "${harnessRoot}/vendor/link-node-modules.sh";
in
{
  assertions = [
    {
      assertion = harnessRoot != "";
      message = "own-my-pi home module needs harnessRoot (live fork/own-my-pi checkout).";
    }
  ];

  home.file = {
    ".pi/agent/settings.json".source = mkLive "agent/${host}/settings.json";
    ".pi/agent/model-roles.json".source = mkLive "agent/${host}/model-roles.json";
    ".pi/agent/mcp.json".source = mkLive "agent/${host}/mcp.json";
    ".pi/agent/spawn.json".source = mkLive "agent/${host}/spawn.json";
    ".pi/agent/compaction.json".source = mkLive "agent/${host}/compaction.json";
    ".pi/agent/personal.json".source = mkLive "agent/shared/personal.json";
    ".pi/agent/agents".source = mkLive "agent/agents";
    ".pi/agent/extensions".source = mkLive "agent/extensions";
    ".pi/agent/skills".source = mkLive "skills";
    ".pi/agent/vendor".source = mkLive "vendor";
    ".local/bin/pi-personal".source = mkLive "agent/bin/pi-personal";
  };

  # Seed gitignored vendor/node_modules from the plugins derivation once,
  # then keep first-party names pointed at live vendor/src.
  home.activation.linkOwnMyPiVendor = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    $DRY_RUN_CMD ${pkgs.bash}/bin/bash ${lib.escapeShellArg linker} \
      --vendor ${lib.escapeShellArg "${harnessRoot}/vendor"} \
      --store ${lib.escapeShellArg "${plugins}"}
  '';
}
