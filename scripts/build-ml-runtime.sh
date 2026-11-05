#!/usr/bin/env bash
# Build the standalone Python ML runtime that ships inside Vaultfolio.
#
# Reproducible: pinned python-build-standalone release + pinned wheels.
# Destination: ml-engine/runtime (gitignored; the DMG build copies it).
#
# Usage: scripts/build-ml-runtime.sh [--arch aarch64-apple-darwin]
# Exits non-zero on any failure. Downloads are cached in ml-engine/_cache.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${ARCH:-aarch64-apple-darwin}"
REL_TAG="20261026"
PY_VERSION="3.12.16"
FORCE=0
PYTHON_DIST_ID="cpython-${PY_VERSION}+${REL_TAG}-${ARCH}"

# Pinned ML stack (macOS arm64 compatible, mutually compatible set)
PIP_PKGS=(
  "numpy==2.3.4"
  "pandas==2.3.3"
  "scikit-learn==1.8.0"
  "scipy==1.16.3"
  "joblib==1.5.2"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --tag) REL_TAG="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Must be computed AFTER --arch is parsed.
PYTHON_DIST_ID="cpython-${PY_VERSION}+${REL_TAG}-${ARCH}"
RUNTIME="$ROOT/ml-engine/runtime"
CACHE="$ROOT/ml-engine/_cache"
mkdir -p "$CACHE" "$(dirname "$RUNTIME")"

# Skip the (network-dependent) rebuild when an existing healthy runtime is
# present, unless --force is given.
if [ "$FORCE" = 0 ] && [ -x "$RUNTIME/bin/python3" ] \
   && "$RUNTIME/bin/python3" -c "import numpy, pandas, sklearn, scipy, joblib" >/dev/null 2>&1; then
  echo "✓ Existing runtime healthy — skipping rebuild (use --force to rebuild)"
  exit 0
fi

PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${REL_TAG}/${PYTHON_DIST_ID}-install_only.tar.gz"
PREDICATE_ID="${PYTHON_DIST_ID/+/%2B}"
PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${REL_TAG}/${PREDICATE_ID}-install_only.tar.gz"

echo "▸ Ensuring CPython ${PY_VERSION} (${ARCH}) from python-build-standalone ${REL_TAG}"
TARBALL="$CACHE/${PYTHON_DIST_ID}.tar.gz"
if [ ! -f "$TARBALL" ]; then
  curl -L --fail -o "$TARBALL" "$PYTHON_URL"
fi
gzip -t "$TARBALL" || { echo "tarball corrupt" >&2; exit 1; }

echo "▸ Extracting runtime"
TMP_EXTRACT="$CACHE/extract-${ARCH}"
rm -rf "$RUNTIME" "$TMP_EXTRACT"
mkdir -p "$TMP_EXTRACT"
tar -xzf "$TARBALL" -C "$TMP_EXTRACT"
mv "$TMP_EXTRACT/python" "$RUNTIME"
rm -rf "$TMP_EXTRACT"

echo "▸ Installing pinned ML libraries"
"$RUNTIME/bin/python3" -m pip install --quiet --no-cache-dir --upgrade pip
"$RUNTIME/bin/python3" -m pip install --no-cache-dir "${PIP_PKGS[@]}"

echo "▸ Freezing installed versions (reproducibility lock)"
"$RUNTIME/bin/python3" -m pip freeze --exclude-editable > "$ROOT/ml-engine/runtime-lock.txt"

echo "▸ Sanity import check"
"$RUNTIME/bin/python3" -c "import numpy, pandas, sklearn, scipy, joblib; print('runtime ok:', numpy.__version__, pandas.__version__, sklearn.__version__)" | tee -a "$ROOT/ml-engine/runtime-lock.txt"

echo "✓ Bundled ML runtime ready at $RUNTIME"
