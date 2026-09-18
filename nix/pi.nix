# Pi CLI in the Nix store.
#
# Git pin: flake input `pi` (github:earendil-works/pi).
# Artifact: published @earendil-works/pi-coding-agent tarball for that
# commit's packages/coding-agent version. The git tree has no dist/; the
# tarball is the prebuilt CLI plus npm-shrinkwrap.json.
#
# npm-shrinkwrap omits integrity for the five @earendil-works workspace
# packages. nix/pi-package-lock.json is that shrinkwrap with those hashes
# filled in so fetchNpmDeps can pin the dep tree.
#
# Bump:
#   1. bump inputs.pi in flake.nix (tag or rev)
#   2. nix flake lock --update-input pi
#   3. replace src hash; regenerate nix/pi-package-lock.json
#   4. nix build .#pi — replace npmDepsHash from the error
{
  lib,
  buildNpmPackage,
  fetchNpmDeps,
  fetchurl,
  jq,
  nodejs,
  piSrc,
}:

let
  manifest = lib.importJSON "${piSrc}/packages/coding-agent/package.json";
  version = manifest.version;
  src = fetchurl {
    url = "https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-${version}.tgz";
    hash = "sha256-H0mHKWSb3OZH0RYJk7TZK/PGFMyBkhO+4vkd008qevQ=";
  };
  # fetchNpmDeps does not always inherit postPatch from buildNpmPackage.
  postPatch = ''
    cp ${./pi-package-lock.json} package-lock.json
    cp ${./pi-package-lock.json} npm-shrinkwrap.json
    ${lib.getExe jq} 'del(.devDependencies)' package.json > package.json.new
    mv package.json.new package.json
  '';
  npmDepsHash = "sha256-Z9VgjzkhNjZoTB+4s4jMV2WN8VMTi9gMPqGe4IMs6IQ=";
in
buildNpmPackage {
  pname = "pi-coding-agent";
  inherit
    version
    nodejs
    src
    postPatch
    npmDepsHash
    ;

  npmDeps = fetchNpmDeps {
    inherit src postPatch;
    name = "pi-coding-agent-${version}-npm-deps";
    hash = npmDepsHash;
  };

  # Published tarball already contains dist/bundle/cli.js.
  dontNpmBuild = true;
  npmFlags = [
    "--ignore-scripts"
    "--omit=dev"
  ];
  npmInstallFlags = [ "--omit=dev" ];
  makeCacheWritable = true;

  passthru = {
    inherit piSrc;
    packageName = "@earendil-works/pi-coding-agent";
  };

  meta = {
    description = "Pi coding agent CLI (@earendil-works/pi-coding-agent)";
    homepage = "https://github.com/earendil-works/pi";
    license = lib.licenses.mit;
    mainProgram = "pi";
  };
}
