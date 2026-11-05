#!/usr/bin/env bash
# Run the Intelligence ML engine test suite with the bundled runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/ml-engine/runtime/bin/python3"
if [ ! -x "$PY" ]; then
  echo "Bundled runtime missing — run scripts/build-ml-runtime.sh first." >&2
  exit 1
fi
cd "$ROOT/ml-engine/service"
PYTHONPATH=".." exec "$PY" -B engine_tests.py "$@"
