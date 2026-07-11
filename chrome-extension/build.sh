#!/bin/bash
# Build chrome extension — copies only required dist files

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DIR")"

# SKIP_BUILD=1 lets the release orchestrator build the player once and reuse it
# across every target instead of rebuilding here (3× otherwise).
if [ -z "$SKIP_BUILD" ]; then
  echo "Building movi-player dist..."
  cd "$ROOT"
  npm run build:ts
else
  echo "Reusing existing dist/element.js (SKIP_BUILD set)"
fi

echo "Copying required files to extension..."
rm -rf "$DIR/dist"
mkdir -p "$DIR/dist"

# Only element.js (standalone bundle with everything) + WASM
cp "$ROOT/dist/element.js" "$DIR/dist/"

echo "Done! Extension size: $(du -sh "$DIR/dist" | cut -f1)"
echo "Load extension from: $DIR"
echo "  → chrome://extensions → Developer mode → Load unpacked"
