{
  description = "Personal Pi coding-agent harness: settings, plugins, skills, Home Manager module";

  outputs =
    { self }:
    {
      homeModules.default = import ./nix/home-module.nix { inherit self; };
    };
}
