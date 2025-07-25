# Cython Language Support Extension Installation Guide

This guide provides detailed instructions for building and installing the Cython language support extension (a fork of Pyright) for VS Code and Windsurf editors.

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- VS Code or Windsurf editor

## Building the Extension

### 1. Install Dependencies

First, install all required dependencies:

```bash
cd /path/to/vs-code-cython/cyright
npm install
```

### 2. Build the Extension

For development build:
```bash
npm run build:extension:dev
```

For production build:
```bash
npm run build:extension:prod
```

The built extension will be located in `packages/vscode-pyright/dist/`.

## Installation Methods

### Method 1: Direct Installation in Windsurf

This is the recommended method for Windsurf users who want a permanent installation.

1. Build the extension (see above)

2. Install (or reinstall) the published Cython extension if it is missing:
   ```bash
   windsurf --install-extension ktnrg45.vscode-cython@1.0.11  # or use the Extensions UI
   ```
   The extension will appear under `~/.windsurf/extensions/ktnrg45.vscode-cython-1.0.11`.

3. Copy **only** the built JavaScript files into the extension’s `dist` folder (this preserves all the built-in typeshed files):
```bash
# Remove old files and copy new server files
rm -f ~/.windsurf/extensions/codeium.windsurfpyright-1.28.0-universal/dist/server.js
rm -f "$EXT_DIR"/dist/server.js.map
cp packages/vscode-pyright/dist/server.js "$EXT_DIR"/dist/
cp packages/vscode-pyright/dist/server.js.map "$EXT_DIR"/dist/

# Remove old files and copy new extension files
rm -f ~/.windsurf/extensions/codeium.windsurfpyright-1.28.0-universal/dist/extension.js
rm -f "$EXT_DIR"/dist/extension.js.map
cp packages/vscode-pyright/dist/extension.js "$EXT_DIR"/dist/
cp packages/vscode-pyright/dist/extension.js.map "$EXT_DIR"/dist/
```

4. Create symlink for server path (required for Windsurf):
```bash
# Create directory structure
mkdir -p "$EXT_DIR"/cyright/packages/vscode-pyright

# Create symlink to dist
ln -sf ../../../dist "$EXT_DIR"/cyright/packages/vscode-pyright/dist
```

5. Restart Windsurf or reload the window (Cmd+R on macOS, Ctrl+R on Windows/Linux)

**Important**: Do NOT delete or replace the entire dist directory as this will break Python builtins and typeshed files.

### Method 2: Development Mode (VS Code)

For development and testing, you can run the extension in a new VS Code window:

1. Open the project in VS Code:
```bash
code /path/to/vs-code-cython/cyright
```

2. Press F5 or go to Run > Start Debugging

3. A new VS Code window will open with the extension loaded

### Method 3: Package and Install VSIX (VS Code)

To create a packaged extension file:

1. Install vsce (Visual Studio Code Extension manager):
```bash
npm install -g vsce
```

2. Build and package the extension:
```bash
cd packages/vscode-pyright
vsce package
```

3. This creates a `.vsix` file that can be installed in VS Code:
   - Open VS Code
   - Go to Extensions view (Cmd+Shift+X / Ctrl+Shift+X)
   - Click the "..." menu > "Install from VSIX..."
   - Select the generated `.vsix` file

## Verifying Installation

1. Open a `.pyx` or `.pxd` file
2. Check that syntax highlighting is working
3. Verify that Cython-specific features are recognized (e.g., `cdef`, `DEF`, pointer types)
4. Ensure that false-positive errors for Cython constructs are suppressed

## Configuration

The extension supports Cython-specific settings. Create or modify `.vscode/settings.json` in your workspace:

```json
{
    "python.analysis.typeCheckingMode": "basic",
    "python.analysis.autoImportCompletions": true,
    "python.analysis.diagnosticMode": "workspace"
}
```

## Troubleshooting

### Extension Not Loading

1. Check the extension is properly installed:
   - VS Code: View > Extensions > Search for "Pyright"
   - Windsurf: Check `~/.windsurf/extensions/` directory

2. Check the Output panel for errors:
   - View > Output > Select "Pyright" from dropdown

### Build Errors

1. Clear node_modules and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

2. Ensure you're using the correct Node.js version:
```bash
node --version  # Should be v14 or higher
```

### TypeScript Compilation Errors

If you encounter TypeScript errors during build:

1. Check that all TypeScript dependencies are installed:
```bash
npm install --save-dev typescript
```

2. Run TypeScript compiler directly to see detailed errors:
```bash
npx tsc --noEmit
```

### Cython Features Not Working

If Cython-specific features aren't recognized:

1. Ensure the file has `.pyx` or `.pxd` extension
2. Check that the language mode is set correctly (should show "Cython" in status bar)
3. Restart the editor after installation

## Development Tips

### Making Changes

1. Edit source files in `packages/pyright-internal/src/`
2. Key files for Cython support:
   - `analyzer/typeEvaluator.ts` - Type evaluation logic
   - `analyzer/types.ts` - Type definitions
   - `common/fileSystem.ts` - File type recognition

3. After changes, rebuild:
```bash
npm run build:extension:dev
```

### Testing Changes

1. Use the development mode (F5 in VS Code) for quick testing
2. For Windsurf, rebuild and copy to extensions directory
3. Test with various Cython files to ensure compatibility

### Common Cython Patterns to Test

- Pointer declarations: `cdef int* ptr`
- NULL comparisons: `if ptr == NULL:`, `if ptr is not NULL:`
- Pointer arithmetic: `ptr + 1`, `ptr[0]`
- C imports: `from libc.stdlib cimport malloc, free`
- DEF constants: `DEF MAX_SIZE = 1000`
- Fused types and templates

## Support

For issues specific to this Cython fork:
- Check existing modifications in the codebase
- Key areas modified for Cython support are marked with comments

For general Pyright issues:
- See the upstream Pyright repository

## Version Information

This extension is based on Pyright version 1.1.270 with additional Cython language support.
