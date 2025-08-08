# Publishing keyvault-tui to npm for bunx

This document describes the complete process of publishing the `keyvault-tui` CLI tool to npm for use with `bunx`.

## Overview

The `keyvault-tui` is a Terminal User Interface (TUI) application for exploring Azure Key Vault secrets. It uses a vendored copy of the `opentui` library, which includes native Zig libraries for terminal rendering.

## Initial Setup

### 1. Package Configuration

Updated `package.json` for npm publishing:

```json
{
  "name": "keyvault-tui",
  "version": "0.1.4",
  "type": "module",
  "module": "index.ts",
  "bin": {
    "keyvault-tui": "bin/kvx.ts"
  },
  "engines": {
    "bun": ">=1.0.0"
  },
  "files": [
    "bin/",
    "kv-explorer.ts",
    "tui.ts", 
    "index.ts",
    "tsconfig.json",
    "README.md",
    "opentui/"
  ],
  "dependencies": {
    "@azure/identity": "^4.11.1",
    "@azure/keyvault-secrets": "^4.10.0",
    "@types/node": "^24.2.0",
    "bun-webgpu": "0.1.0",
    "jimp": "1.6.0",
    "three": "0.177.0",
    "yoga-layout": "3.2.1",
    "@dimforge/rapier2d-simd-compat": "^0.17.3",
    "planck": "^1.4.2"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### 2. Binary Entry Point

Created `bin/kvx.ts` as the CLI entry point:

```typescript
#!/usr/bin/env bun
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
await import(join(__dirname, "..", "kv-explorer.ts"))
```

### 3. Smoke Test Feature

Added `--smoke-test` flag to `kv-explorer.ts` for testing without Azure dependencies:

```typescript
// Check for smoke test mode
if (process.argv.includes('--smoke-test')) {
  console.log('SMOKE_OK')
  process.exit(0)
}
```

## The Critical Issue: Missing Native Libraries

### Problem Discovery

The package was failing to run with silent exits. Investigation revealed:

1. **Local execution worked**: `bun run kv:explorer --smoke-test` ✓
2. **Published package failed**: `bunx keyvault-tui@latest --smoke-test` ✗
3. **Tarball inspection showed missing files**: Native libraries were excluded

### Root Cause

The `opentui/.gitignore` file contained:

```gitignore
# Zig build cache
.zig-cache
zig-out
src/zig/lib    # ← This line excluded ALL native libraries!
```

This meant the compiled native libraries (`.dylib`, `.so`, `.dll`) were never included in the npm package.

### The Fix

Commented out the problematic line in `opentui/.gitignore`:

```diff
# Zig build cache
.zig-cache
zig-out
- src/zig/lib
+ # src/zig/lib
```

### Impact Verification

**Before Fix:**
- Package size: 1.9 MB
- Files: 107
- Native libraries: ❌ None included

**After Fix:**
- Package size: 3.3 MB  
- Files: 113
- Native libraries: ✅ All platforms included
  - `opentui/src/zig/lib/aarch64-macos/libopentui.dylib` (130KB)
  - `opentui/src/zig/lib/x86_64-macos/libopentui.dylib` (96KB)
  - `opentui/src/zig/lib/x86_64-linux/libopentui.so` (1.5MB)
  - `opentui/src/zig/lib/aarch64-linux/libopentui.so` (1.5MB)
  - `opentui/src/zig/lib/x86_64-windows/opentui.dll` (245KB)
  - `opentui/src/zig/lib/x86_64-windows/opentui.pdb` (1.1MB)

## Publishing Process

### 1. Build Native Libraries

```bash
bun run opentui:build
```

This compiles the Zig libraries for all supported platforms.

### 2. Version and Pack

```bash
npm version patch
npm pack
```

### 3. Verify Tarball Contents

```bash
tar -tf keyvault-tui-*.tgz | grep -E 'opentui/src/zig/lib/.*/libopentui'
```

Should show native libraries for all platforms.

### 4. Publish to npm

```bash
npm publish --access public
```

### 5. Test Published Version

```bash
bunx keyvault-tui@latest --smoke-test
```

## Local Testing Script

Created `scripts/pack-test.ts` to automate local testing:

```typescript
#!/usr/bin/env bun

import { $ } from "bun"
import { join } from "path"

const run = (cmd: string) => {
  console.log(`[pack-test] ${cmd}`)
  return $`${cmd}`.text()
}

console.log("[pack-test] Ensuring bin is executable…")
await $`chmod +x bin/kvx.ts`

console.log("[pack-test] Building OpenTUI native library (if needed)…")
await $`bun run opentui:build`

console.log("[pack-test] Packing npm tarball…")
const packOutput = await $`npm pack`.text()
const tarballLine = packOutput.trim().split('\n').pop()!
console.log(`[pack-test] Created: ${tarballLine}`)

const tarballPath = join(process.cwd(), tarballLine)

console.log("[pack-test] Installing tarball globally with npm (to resolve deps)…")
await $`npm install -g ${tarballPath}`

console.log("[pack-test] Running keyvault-tui (smoke test)…")
await $`keyvault-tui --smoke-test`

console.log("[pack-test] Cleaning up global install…")
await $`npm uninstall -g keyvault-tui`

console.log("[pack-test] ✅ Local pack test successful!")
```

Usage: `bun run pack:test`

## Key Lessons Learned

### 1. Always Include Runtime Dependencies

When vendoring a library with native components, ensure:
- Native libraries are not gitignored in the final package
- All runtime dependencies are listed in `dependencies` (not `devDependencies`)
- Platform-specific binaries are included for target platforms

### 2. Test the Actual Published Package

Local testing isn't sufficient. The published package may differ due to:
- `.gitignore` exclusions
- `package.json` `files` field limitations  
- Different dependency resolution

### 3. Smoke Testing is Essential

For packages with external dependencies (Azure CLI, native libraries), implement a smoke test mode that validates core functionality without requiring full setup.

### 4. bunx vs npm install -g

`bunx` has limitations with local tarball testing. For reliable local testing of packages with complex dependencies, use:

```bash
npm install -g ./package.tgz
package-name --smoke-test
npm uninstall -g package-name
```

## Current Status

✅ **Published**: `keyvault-tui@0.1.4` available on npm  
✅ **Bunx Compatible**: `bunx keyvault-tui` works  
✅ **Cross-Platform**: Native libraries included for all platforms  
✅ **Automated Testing**: `bun run pack:test` validates local builds  

## Usage

Install and run:
```bash
bunx keyvault-tui
```

Or for smoke test:
```bash
bunx keyvault-tui --smoke-test
```

## Future Improvements

1. **Postinstall Script**: Add a postinstall script to build native libraries if missing for the current platform
2. **Smaller Package**: Consider platform-specific packages or lazy loading of native libraries
3. **CI/CD**: Automate testing across multiple platforms before publishing 