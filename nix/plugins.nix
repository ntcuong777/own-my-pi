{ pkgs, self }:
pkgs.buildNpmPackage {
  pname = "own-my-pi-plugins";
  version = "0.1.0";
  src = pkgs.lib.cleanSourceWith {
    src = self + "/vendor";
    filter =
      path: type:
      let
        base = baseNameOf path;
      in
      base != "node_modules";
  };
  npmDepsHash = "sha256-bsGW+vd2k/YM5zHZLZrmuP8MIQkwtnKRLxZ/9QPnEYA=";
  dontNpmBuild = true;
  npmFlags = [ "--legacy-peer-deps" ];
  makeCacheWritable = true;
  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -a node_modules $out/
    cp package.json package-lock.json $out/
    runHook postInstall
  '';
}
