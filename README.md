# keyvault-tui

A beautiful Terminal User Interface (TUI) for exploring Azure Key Vault secrets. Built with Bun and TypeScript.

## Features

- 🔑 Browse Key Vault secrets across all Azure subscriptions
- 🔍 Real-time filtering and search
- 📝 View secret metadata and values
- ✏️ Create new secrets
- ✏️ Edit secret values in-place
- 📋 Copy secrets to clipboard (macOS)
- 🔄 Rename secrets (creates new, attempts to delete old)
- 📦 Move secrets between Key Vaults (non-destructive copy)
- ⌨️ Vim-like navigation and commands
- 🎨 Clean, responsive terminal interface

## Built With

This application is built using [OpenTUI](https://github.com/sst/opentui), a TypeScript library for building terminal user interfaces. OpenTUI provides the foundational TUI framework with native Zig rendering for high-performance terminal graphics.

## Installation

### Prerequisites

- **Bun** (>= 1.0.0) - [Install Bun](https://bun.sh)
- **Azure CLI** - [Install Azure CLI](https://aka.ms/azure-cli)
- **Zig** (for building native libraries if needed) - [Install Zig](https://ziglang.org/download/)

### Quick Start

```bash
# Ensure you're logged into Azure
az login

# Run the application
bunx keyvault-tui
```

## Usage

### Navigation

- **Tab** - Switch focus between filter and list
- **/** - Jump to filter/search input
- **↑↓** or **j/k** - Navigate list items
- **Enter** - Select vault or open secret details
- **Esc** - Go back one level (detail → list → vault selection)
- **b** - Alternative back navigation

### Secret Management

When viewing a secret (after pressing Enter on it):

- **n** - Create new secret (prompts for name, then value)
- **e** - Edit secret value
- **c** - Copy secret value to clipboard
- **r** - Rename secret (creates new with same value)
- **m** - Move/copy secret to another Key Vault

### Commands

- **:q** - Quit application (vim-style)
- **Esc** - Close command bar or navigate back

### Workflow

1. **Select Key Vault**: Application loads all Key Vaults from your Azure subscriptions
2. **Browse Secrets**: Use filter to find secrets, press Enter to view details
3. **Manage Secrets**: Use keyboard shortcuts to create, edit, copy, rename, or move secrets
4. **Navigate**: Use Esc to go back to previous views

## Development

### Local Development

```bash
# Clone and setup
git clone <repository>
cd keyvault-tui
bun install

# Build OpenTUI native libraries
bun run opentui:build

# Run locally
bun run kv:explorer

# Or run smoke test (no Azure required)
bun run kv:explorer --smoke-test
```

### Testing Local Package

```bash
# Test the full packaging pipeline
bun run pack:test
```

This script builds the native libraries, creates an npm package, installs it globally, tests it with smoke test, and cleans up.

### Publishing

1. Build native libraries: `bun run opentui:build`
2. Version bump: `npm version patch|minor|major`
3. Pack and verify: `npm pack && tar -tf keyvault-tui-*.tgz | grep libopentui`
4. Publish: `npm publish --access public`

## Architecture

- **Frontend**: TypeScript with OpenTUI for terminal rendering
- **Backend**: Azure CLI for authentication, `@azure/keyvault-secrets` for Key Vault operations
- **Native Layer**: Zig libraries (via OpenTUI) for high-performance terminal graphics
- **Packaging**: Vendored OpenTUI with cross-platform native libraries included

## Troubleshooting

### Common Issues

1. **"Azure CLI not found"** - Install Azure CLI and run `az login`
2. **"Failed to load Key Vaults"** - Ensure you have proper Azure permissions
3. **Native library errors** - Run `bun run opentui:build` to rebuild platform libraries

### Debug Mode

Run with smoke test to verify installation without Azure dependencies:

```bash
bunx keyvault-tui --smoke-test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `bun run pack:test`
5. Submit a pull request

## License

[Your License Here]

## Acknowledgments

- Built with [OpenTUI](https://github.com/sst/opentui) by the SST team
- Inspired by modern terminal applications and vim-like interfaces
