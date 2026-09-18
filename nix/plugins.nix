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

    ln -sfn ../../src/pi-neuralwatt "$out/node_modules/@aliou/pi-neuralwatt"
    ln -sfn ../../src/pi-utils-settings "$out/node_modules/@aliou/pi-utils-settings"
    ln -sfn ../../src/pi-utils-ui "$out/node_modules/@aliou/pi-utils-ui"
    ln -sfn ../../src/rpiv-ask-user-question "$out/node_modules/@juicesharp/rpiv-ask-user-question"
    ln -sfn ../../src/rpiv-config "$out/node_modules/@juicesharp/rpiv-config"
    ln -sfn ../../src/rpiv-i18n "$out/node_modules/@juicesharp/rpiv-i18n"
    ln -sfn ../../src/rpiv-todo "$out/node_modules/@juicesharp/rpiv-todo"
    ln -sfn ../../src/rpiv-web-tools "$out/node_modules/@juicesharp/rpiv-web-tools"
    ln -sfn ../../src/pi-plan-mode "$out/node_modules/@narumitw/pi-plan-mode"
    ln -sfn ../../src/pi-tui-kit "$out/node_modules/@narumitw/pi-tui-kit"
    ln -sfn ../src/pi-antiloop "$out/node_modules/pi-antiloop"
    ln -sfn ../src/pi-ast-grep "$out/node_modules/pi-ast-grep"
    ln -sfn ../src/pi-codex-account "$out/node_modules/pi-codex-account"
    ln -sfn ../src/pi-hashline-edit "$out/node_modules/pi-hashline-edit"
    ln -sfn ../src/pi-lens "$out/node_modules/pi-lens"
    ln -sfn ../src/pi-mcp-adapter "$out/node_modules/pi-mcp-adapter"
    ln -sfn ../src/pi-smart-compact "$out/node_modules/pi-smart-compact"
    ln -sfn ../src/pi-subagents "$out/node_modules/pi-subagents"

    mkdir -p "$out/src/pi-subagents/node_modules"
    ln -sfn ../../../node_modules/undici-v8 "$out/src/pi-subagents/node_modules/undici"

    runHook postInstall
  '';
}
