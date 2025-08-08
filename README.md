# Key Vault TUI

A fast terminal UI for browsing and managing Azure Key Vault secrets. Built with Bun and the vendored OpenTUI library.

## Features

- Discover Key Vaults across all subscriptions via Azure CLI
- Filter and select vaults and secrets
- View secret metadata and values
- Quick actions on a selected secret:
  - `e`: edit value
  - `c`: copy value to clipboard (macOS `pbcopy`)
  - `r`: rename (creates new name with same value; attempts best-effort delete of old)
  - `m`: move (copy) to another vault with new name (non-destructive)
- Vim-like command bar under the header for prompts and `:q` to quit
- Hierarchical navigation with `Esc` (detail → list → vaults)

## Install (bunx)

Once published to npm:

```bash
bunx keyvault-tui
```

Or install globally:

```bash
bun add -g keyvault-tui
keyvault-tui
```

## Requirements

- Bun >= 1.0
- Azure CLI (`az`) installed and logged in: `az login`
- For clipboard copy on macOS: `pbcopy` (built-in). On Linux/WSL, clipboard is not yet auto-detected
- OpenTUI native lib is vendored and built with Zig for your platform. If the prebuilt lib is not present, run:

```bash
bun run opentui:build
```

If you see an error about missing native library, ensure Zig is installed: `brew install zig` (macOS) or install from ziglang.org for your OS.

## Usage

- `Tab`: switch focus between filter and list
- `/`: focus filter, type to narrow the list
- `Enter`: open (vault → load secrets; secret → load details)
- `Esc`: go back layer-by-layer
- `:`: open command bar (use `:q` to quit)
- On a secret detail:
  - `e`: edit value (command bar opens with prefilled value)
  - `c`: copy value to clipboard
  - `r`: rename (enter new name)
  - `m`: move (select target vault in left list, then enter new name)

## Develop

- Run directly:

```bash
bun run kv-explorer.ts
```

- Rebuild OpenTUI native libs:

```bash
bun run opentui:build
```

- Package locally for testing:

```bash
npm pack
bunx ./keyvault-tui-*.tgz
```

## Notes

- This package vendors `opentui/` in the repo; no external dependency is required for the TUI other than Bun.
- Azure permissions must allow `secrets/list`, `secrets/get` for browsing, and `secrets/set` for edit/rename/move.
