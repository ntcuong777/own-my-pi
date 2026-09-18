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
  npmDepsHash = "sha256-E+fdGrVyZLyBi0GO+SME3mxdH8kNQ7P5NbzwSih0u4E=";
  dontNpmBuild = true;
  npmFlags = [ "--legacy-peer-deps" ];
  makeCacheWritable = true;
  installPhase = ''
    runHook preInstall
    mkdir -p $out/node_modules/@aliou $out/node_modules/@juicesharp $out/node_modules/@narumitw
    cp -a src $out/src
    cp -a node_modules/. $out/node_modules/
    cp package.json package-lock.json $out/
    cp link-node-modules.sh $out/
    bash ./link-node-modules.sh --vendor "$out"
    runHook postInstall
  '';
}
