#!/usr/bin/env bash
# Full macOS release build for Vaultfolio with the Intelligence ML runtime.
#
# Stages: frontend → ML engine tests → bundled runtime → Tauri app+DMG →
# bundle inspection → DMG size gate (fails below 50 MiB / 52,428,800 bytes).
#
# Usage: scripts/release-macos.sh [aarch64|x86_64|both]
# Exits 1 if the DMG is shorter than 52,428,800 bytes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-aarch64}"
MIN_BYTES=52428800
MIN_MIB="50"

echo "═══ 1/7 Frontend production build ═══"
npm run typecheck
npm test
npm run build

echo "═══ 2/7 Bundled Python runtime ═══"
case "$TARGET" in
  aarch64) bash scripts/build-ml-runtime.sh --arch aarch64-apple-darwin ;;
  x86_64)  bash scripts/build-ml-runtime.sh --arch x86_64-apple-darwin ;;
  both)
    bash scripts/build-ml-runtime.sh --arch aarch64-apple-darwin
    # x64 runtime is placed temporarily for the second tauri build pass.
    ;;
  *) echo "unknown target" >&2; exit 2 ;;
esac

echo "═══ 3/7 ML engine test suite ═══"
bash scripts/ml-engine-tests.sh 2>&1 | tail -3

echo "═══ 4/7 Tauri application bundle ═══"
build_target() {
  local t="$1"
  npx tauri build --target "$t" --config src-tauri/tauri.macos.json
}
case "$TARGET" in
  aarch64) build_target aarch64-apple-darwin ;;
  x86_64)  build_target x86_64-apple-darwin ;;
  both)
    build_target aarch64-apple-darwin
    # swap runtimes between builds
    mv ml-engine/runtime ml-engine/runtime-arm64-keep
    VAULTFOLIO_ML_ENGINE_SKIP=1 bash scripts/build-ml-runtime.sh --arch x86_64-apple-darwin
    build_target x86_64-apple-darwin
    ;;
esac

echo "═══ 5/7 Bundle inspection ═══"
check_bundle() {
  local t="$1"
  local app="$ROOT/src-tauri/target/${t}/release/bundle/macos/Vaultfolio.app"
  if [ ! -d "$app" ]; then echo "✗ App bundle missing: $app"; exit 1; fi
  ls -1 "$app/Contents/Resources/ml-engine/runtime/bin/python3" >/dev/null \
    || { echo "✗ Bundled Python runtime not present in the app bundle"; exit 1; }
  "$app/Contents/Resources/ml-engine/runtime/bin/python3" -c "import numpy, pandas, sklearn, scipy, joblib" \
    || { echo "✗ Bundled runtime failed to import its ML stack"; exit 1; }
  local runtime_size
  runtime_size=$(du -sk "$app/Contents/Resources/ml-engine" | cut -f1)
  echo "✓ ml-engine resources inside app: ${runtime_size} KiB"
}
check_bundle aarch64-apple-darwin
[ "$TARGET" != "x86_64" ] || check_bundle x86_64-apple-darwin

echo "═══ 6/7 DMG creation (drag-and-drop layout) ═══"
mkdir -p dist-desktop
make_dmg() {
  local t="$1" suffix="$2"
  local app="$ROOT/src-tauri/target/${t}/release/bundle/macos/Vaultfolio.app"
  # Re-sign ad-hoc (deep) after bundling so the Python sidecar is covered,
  # unless a Developer ID build already produced hardened runtime signatures.
  if ! codesign -dv "$app" >/dev/null 2>&1 || [ "${VAULTFOLIO_DEVELOPER_ID:-0}" != "1" ]; then
    codesign --force --deep --sign - "$app" || { echo "✗ ad-hoc signing failed"; exit 1; }
  fi
  codesign --verify --deep --strict "$app" || { echo "✗ signature verification failed"; exit 1; }

  local stage="$ROOT/src-tauri/target/${t}/release/bundle/dmg/dmg-stage"
  rm -rf "$stage" && mkdir -p "$stage"
  cp -R "$app" "$stage/Vaultfolio.app"
  ln -s /Applications "$stage/Applications"
  local dmg_name
  if [ "$t" = "aarch64-apple-darwin" ]; then
    dmg_name="Vaultfolio-macOS-Apple-Silicon.dmg"
  else
    dmg_name="Vaultfolio-macOS${suffix}.dmg"
  fi
  hdiutil create -volname Vaultfolio -srcfolder "$stage" -ov -format UDZO \
    "$ROOT/dist-desktop/${dmg_name}" >/dev/null
  hdiutil verify "$ROOT/dist-desktop/${dmg_name}" >/dev/null
  if [ "$t" = "aarch64-apple-darwin" ]; then
    cp -f "$ROOT/dist-desktop/${dmg_name}" "$ROOT/dist-desktop/Vaultfolio-macOS.dmg"
  fi
}
make_dmg aarch64-apple-darwin ""
[ "$TARGET" != "x86_64" ] || make_dmg x86_64-apple-darwin "-x64"

echo "═══ 7/7 SIZE GATE — minimum ${MIN_MIB} MiB (${MIN_BYTES} bytes) ═══"
dmg="$ROOT/dist-desktop/Vaultfolio-macOS-Apple-Silicon.dmg"
[ "$TARGET" != "x86_64" ] || dmg="$ROOT/dist-desktop/Vaultfolio-macOS-x64.dmg"
BYTES=$(stat -f%z "$dmg")
MIB=$(echo "scale=1; $BYTES / 1048576" | bc)
echo "  artifact: $dmg"
echo "  bytes:    $BYTES"
echo "  MiB:      $MIB"
if [ "$BYTES" -lt "$MIN_BYTES" ]; then
  echo "✗ RELEASE FAILURE: DMG is ${MIB} MiB — below the hard minimum of ${MIN_MIB} MiB." >&2
  echo "  Inspect which bundle components were omitted before re-releasing." >&2
  exit 1
fi
echo "✓ SIZE GATE PASSED"
echo "Done: $dmg"
