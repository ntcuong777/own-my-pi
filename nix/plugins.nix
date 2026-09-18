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
  npmDepsHash = "sha256-drhIdGFwO48lr9B/RzslGNW3PRhgJXlVDhsEg3l/l+g=";
  dontNpmBuild = true;
  npmFlags = [ "--legacy-peer-deps" ];
  makeCacheWritable = true;
  installPhase = ''
    runHook preInstall
    mkdir -p $out/node_modules/@aliou $out/node_modules/@juicesharp $out/node_modules/@narumitw $out/node_modules/@samfp $out/node_modules/@earendil-works
    cp -a src $out/src
    cp -a node_modules/. $out/node_modules/
    cp package.json package-lock.json $out/
    cp link-node-modules.sh $out/
    bash ./link-node-modules.sh --vendor "$out"
    runHook postInstall
  '';
}
