#!/usr/bin/env bash
# Packages the extension as dist/askbetter-<version>.zip with the release version
# stamped into its manifest. The version is the first argument (a tag such as
# v1.2.3 or v1.3.0-beta.1), else the latest git tag. Chrome only accepts dotted
# numbers as `version`, so a pre-release suffix goes into `version_name` only.
# The tag is the only source of the version: manifest.json in the repo stays at
# 0.0.0, which is what "Load unpacked" shows for a development build.
# Only what the extension loads is shipped: site/, store-assets/, scripts/ and the
# docs stay out of the store package.
set -euo pipefail
cd "$(dirname "$0")/.."
tag="${1:-$(git describe --tags --abbrev=0 --match 'v*')}"
full="${tag#v}"
version="${full%%-*}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Not a release version: $tag (expected vX.Y.Z or vX.Y.Z-suffix)" >&2
  exit 1
fi

zip="dist/askbetter-$full.zip"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -r background.js content injected ui assets LICENSE "$stage/"
VERSION="$version" VERSION_NAME="$full" node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  manifest.version = process.env.VERSION;
  if (process.env.VERSION_NAME !== process.env.VERSION) manifest.version_name = process.env.VERSION_NAME;
  else delete manifest.version_name;
  fs.writeFileSync(process.argv[1], JSON.stringify(manifest, null, 2) + "\n");
' "$stage/manifest.json"

mkdir -p dist
rm -f "$zip"
(cd "$stage" && zip -q -r -X - manifest.json background.js content injected ui assets LICENSE) > "$zip"
unzip -tq "$zip"
echo "Packaged $zip (manifest version $version)"
