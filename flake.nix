{
  description = "Personal Pi coding-agent harness: settings, vendored plugins, skills, Home Manager module";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      homeModules.default = import ./nix/home-module.nix { inherit self; };

      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          plugins = pkgs.callPackage ./nix/plugins.nix { inherit self; };
        in
        {
          inherit plugins;
          default = plugins;
        }
      );
    };
}
