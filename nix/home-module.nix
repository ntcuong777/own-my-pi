# Home Manager module for this Pi harness.
#
# Import via `inputs.own-my-pi.homeModules.default`.
# Config and skills copy from this flake (store paths). Plugin
# node_modules come from `nix/plugins.nix` (lockfile + vendored sources).
# Extra args: userhome, isWorkstation.
{ self }:
{
  config,
  lib,
  pkgs,
  userhome,
  isWorkstation ? false,
  ...
}:

let
  host = if isWorkstation then "workstation" else "laptop";
  plugins = pkgs.callPackage ./plugins.nix { inherit self; };

  mkStoreLink = target: source: {
    name = target;
    value.source = "${self}/${source}";
  };

  skillNames = builtins.attrNames (
    lib.filterAttrs (_: t: t == "directory") (builtins.readDir "${self}/skills")
  );

  extensionFiles = [ "rtk.ts" ];

  links =
    [
      (mkStoreLink ".pi/agent/settings.json" "agent/${host}/settings.json")
      (mkStoreLink ".pi/agent/model-roles.json" "agent/${host}/model-roles.json")
      (mkStoreLink ".pi/agent/mcp.json" "agent/${host}/mcp.json")
      (mkStoreLink ".pi/agent/spawn.json" "agent/${host}/spawn.json")
      (mkStoreLink ".pi/agent/compaction.json" "agent/${host}/compaction.json")
      (mkStoreLink ".pi/agent/personal.json" "agent/shared/personal.json")
      (mkStoreLink ".pi/agent/agents" "agent/agents")
      (mkStoreLink ".local/bin/pi-personal" "agent/bin/pi-personal")
    ]
    ++ map (name: mkStoreLink ".pi/agent/extensions/${name}" "agent/extensions/${name}") extensionFiles
    ++ map (name: mkStoreLink ".pi/agent/skills/${name}" "skills/${name}") skillNames;
in
{
  home.file = lib.listToAttrs links // {
    ".pi/agent/vendor".source = plugins;
  };
}
