#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "[cyright] Installing dependencies (root and packages)…"
cd "$REPO_ROOT"

# Ensure VS Code package name is not left renamed from a failed package step
if [ -d "$REPO_ROOT/packages/vscode-pyright" ]; then
  (cd "$REPO_ROOT/packages/vscode-pyright" && node ./build/renamePackage.js vscode-pyright) >/dev/null 2>&1 || true
fi

# Install root deps and all package deps (uses lerna under the hood)
npm run install:all

echo "[cyright] Initializing/updating submodules…"
git submodule update --init --recursive || true

echo "[cyright] Building CLI (packages/pyright)…"
npm run build:cli:dev

echo "[cyright] Linking CLI globally…"
cd "$REPO_ROOT/packages/pyright"
npm link

echo "[cyright] Done. 'pyright' now points to this cyright build."
echo "[cyright] Verifying installation…"
CMD_PATH="$(command -v pyright || true)"
echo "[cyright] pyright resolved to: ${CMD_PATH:-<not found>}"
echo "[cyright] Global pyright --version:"
pyright --version || true
echo "[cyright] Local CLI --version via index.js:"
node "$REPO_ROOT/packages/pyright/index.js" --version || true

echo "[cyright] Building VS Code extension…"
cd "$REPO_ROOT"
# Ensure subpackage deps
npm --prefix "$REPO_ROOT/packages/vscode-pyright" install
# Clean any prior VSIX
rm -f "$REPO_ROOT"/packages/vscode-pyright/*.vsix || true
# Package VSIX (handles renaming to 'pyright' before packaging)
npm --prefix "$REPO_ROOT/packages/vscode-pyright" run package

echo "[cyright] Installing VS Code extension…"
VSIX_PATH=$(ls -1t "$REPO_ROOT"/packages/vscode-pyright/*.vsix 2>/dev/null | head -n1) || true
CODE_BIN=""

# Try multiple editor CLIs: VS Code, Code Insiders, Cursor
if command -v code >/dev/null 2>&1; then
  CODE_BIN="$(command -v code)"
elif [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  CODE_BIN="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
elif command -v code-insiders >/dev/null 2>&1; then
  CODE_BIN="$(command -v code-insiders)"
elif [ -x "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" ]; then
  CODE_BIN="/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
elif command -v cursor >/dev/null 2>&1; then
  CODE_BIN="$(command -v cursor)"
elif [ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]; then
  CODE_BIN="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
fi

if [ -n "$CODE_BIN" ]; then
  echo "[cyright] Using Editor CLI: $CODE_BIN"
  if [ -n "${VSIX_PATH:-}" ] && [ -f "$VSIX_PATH" ]; then
    "$CODE_BIN" --install-extension "$VSIX_PATH" --force || true
  else
    echo "[cyright] VSIX not found; skipping extension install"
  fi
  echo "[cyright] Installed extensions (filtered):"
  "$CODE_BIN" --list-extensions | grep -i "cython\|pyright" || true
else
  echo "[cyright] Editor CLI not found; skipping extension install"
fi

# Ensure the VS Code package name is restored after packaging/install steps
if [ -d "$REPO_ROOT/packages/vscode-pyright" ]; then
  (cd "$REPO_ROOT/packages/vscode-pyright" && node ./build/renamePackage.js vscode-pyright) >/dev/null 2>&1 || true
fi

