{
  description = "Personal Pi coding-agent harness: settings, vendored plugins, skills, Home Manager module";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    pi = {
      url = "github:earendil-works/pi/v0.85.1";
      flake = false;
    };
  };

  outputs =
    { self, nixpkgs, pi }:
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
      homeModules.default = import ./nix/home-module.nix {
        inherit self;
        piSrc = pi;
      };

      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          plugins = pkgs.callPackage ./nix/plugins.nix { inherit self; };
          pi-coding-agent = pkgs.callPackage ./nix/pi.nix { piSrc = pi; };
        in
        {
          inherit plugins;
          pi = pi-coding-agent;
          default = pi-coding-agent;
        }
      );
    };
}
