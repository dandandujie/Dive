# Dive

[中文](README.md) | English

Dive is a desktop client for DeepSeek Harness. It packages the official `@deepseek-ai/dsh` runtime, Web profile, and existing frontend inside Electron, so users do not need a separate Node.js/npm installation or a manually managed Web port.

> This release depends on the official `@deepseek-ai/dsh@0.1.0-rc.6`. Dive is a community project, not an official DeepSeek distribution.

![The official DeepSeek Harness interface running in Dive](docs/screenshot.png)

## Architecture

Dive starts the official Harness Web profile in a supervised Node child process, waits for its OS-assigned `127.0.0.1` port, and loads that exact origin in a sandboxed `BrowserWindow`. The packaged Electron executable supplies Node, so users do not install a separate runtime. The runtime and window share one application lifecycle. Sessions, settings, credentials, and profiles live under Dive's Electron `userData` directory, while workspace and tool behavior remains owned by Harness.

The renderer has no Node.js or Electron API access. Cross-origin navigation, non-HTTPS external links, and page permission requests are denied. On quit, Dive gives Harness a bounded graceful-shutdown interval so persistence and plugin disposal can finish, then terminates a process that does not exit.

## Development

Node.js 22.19 or newer and pnpm 11.7 are required.

```bash
pnpm install
pnpm run dev
```

Configure the DeepSeek API key in the existing Harness settings screen and select a code directory from the workspace picker.

## Verification and packaging

```bash
pnpm run check
DIVE_SMOKE_SCREENSHOT=/tmp/dive-smoke.png pnpm run test:desktop
pnpm run dist:dir
pnpm run dist
```

Tags matching `v*` and manual workflow runs build macOS arm64/x64, Windows x64, and Linux x64 artifacts in GitHub Actions.

## Limitations

- Apple Developer ID and Windows code signing are not configured, so local and CI artifacts may trigger unsigned-application warnings.
- The package does not use ASAR. Harness creates module links from its writable profile directory to installed dependencies, which requires real filesystem paths.
- Dive pins a prerelease Harness version; upgrades require lifecycle tests and a desktop smoke test.

## Upstream and license

Dive is based on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Both projects use the MIT License. The Electron process and navigation policy follows the [official Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
