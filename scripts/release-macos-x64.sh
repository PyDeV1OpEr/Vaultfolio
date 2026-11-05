#!/usr/bin/env bash
# Secondary x86_64 pass: swap runtimes so the DMG embeds the x64 Python.
# Always restores the arm64 runtime at the end (success or failure).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATUS=1
restore() {
  # The x64 runtime lives at ml-engine/runtime while building; put the arm64
  # copy back in place and keep the x64 one aside for future x64 passes.
  if [ -d ml-engine/runtime ] && [ -d ml-engine/runtime-arm64-keep ]; then
    mv ml-engine/runtime ml-engine/runtime-x64-keep 2>/dev/null || true
  fi
  if [ ! -d ml-engine/runtime ] && [ -d ml-engine/runtime-arm64-keep ]; then
    mv ml-engine/runtime-arm64-keep ml-engine/runtime 2>/dev/null || true
  fi
}
trap 'restore; exit $STATUS' EXIT

arm64_arch_ok() { file ml-engine/runtime/bin/python3 2>/dev/null | grep -q arm64; }

echo "═══ x64/1 Swap out the arm64 runtime ═══"
if [ -d ml-engine/runtime ] && arm64_arch_ok; then
  if [ -d ml-engine/runtime-arm64-keep ]; then
    rm -rf ml-engine/runtime-arm64-keep
  fi
  mv ml-engine/runtime ml-engine/runtime-arm64-keep
fi

echo "═══ x64/2 Build x64 Python runtime + wheels ═══"
bash scripts/build-ml-runtime.sh --arch x86_64-apple-darwin --force || exit 1

echo "═══ x64/3 Verify the interpreter is really x86_64 ═══"
file ml-engine/runtime/bin/python3 | grep -q x86_64 \
  || { echo "✗ bundled python is not x86_64" >&2; exit 1; }
ml-engine/runtime/bin/python3 -c "import numpy, pandas, sklearn, scipy, joblib" || exit 1

echo "═══ x64/4 ML engine tests on x64 runtime ═══"
bash scripts/ml-engine-tests.sh 2>&1 | tail -3

echo "═══ x64/5 Tauri build (x86_64-apple-darwin) ═══"
# Only the app bundle is needed here; the script stages its own DMG.
npx tauri build --target x86_64-apple-darwin --config src-tauri/tauri.macos.json || exit 1

APP="$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Vaultfolio.app"
[ -d "$APP" ] || { echo "✗ x64 app bundle missing" >&2; exit 1; }

echo "═══ x64/6 Bundle inspection ═══"
file "$APP/Contents/MacOS/vaultfolio" | grep -q x86_64 || { echo "✗ main binary not x86_64" >&2; exit 1; }
file "$APP/Contents/Resources/ml-engine/runtime/bin/python3" | grep -q x86_64 \
  || { echo "✗ bundled runtime inside the app is not x86_64" >&2; exit 1; }
"$APP/Contents/Resources/ml-engine/runtime/bin/python3" -c "import numpy, pandas, sklearn, scipy, joblib" || exit 1
du -sk "$APP/Contents/Resources/ml-engine" | cut -f1

echo "═══ x64/7 DMG + size gate ═══"
if ! codesign -dv "$APP" >/dev/null 2>&1 || [ "${VAULTFOLIO_DEVELOPER_ID:-0}" != "1" ]; then
  codesign --force --deep --sign - "$APP" || exit 1
fi
codesign --verify --deep --strict "$APP" || exit 1
STAGE="$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/dmg-stage"
rm -rf "$STAGE" "$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/rw."*.dmg
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/Vaultfolio.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname Vaultfolio -srcfolder "$STAGE" -ov -format UDZO \
  "$ROOT/dist-desktop/Vaultfolio-macOS-x64.dmg" >/dev/null || exit 1
hdiutil verify "$ROOT/dist-desktop/Vaultfolio-macOS-x64.dmg" >/dev/null || exit 1
BYTES=$(stat -f%z "$ROOT/dist-desktop/Vaultfolio-macOS-x64.dmg")
echo "x64 DMG bytes: $BYTES"
if [ "$BYTES" -lt 52428800 ]; then
  echo "✗ x64 DMG below the 50 MiB gate" >&2
  exit 1
fi
STATUS=0
exit 0
