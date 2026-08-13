# Electron-owned Harness lifecycle

Status: implemented

## Problem

DeepSeek Harness ships a complete Web profile but requires a local Node.js installation and a separately managed server process. A desktop distribution must preserve the official UI and plugin composition while making server startup, port selection, persistent data, failure reporting, and shutdown part of one application lifecycle.

## Decision

Dive uses Electron because Harness and its plugin graph already run on Node.js. The Electron main process starts the published `@deepseek-ai/dsh` Web profile as a Node child of the packaged Electron executable with the Cordis-required `--expose-internals` flag and an OS-assigned loopback port, accepts only the CLI's exact `dsh web: http://127.0.0.1:<port>` announcement, and loads that origin in a sandboxed `BrowserWindow`.

The child process receives a Dive-owned `DSH_HOME` below Electron's `userData` directory and uses the user's home directory as its initial working directory. Harness continues to own sessions, settings, credentials, workspaces, tools, approvals, and the Web frontend. Dive owns only desktop lifecycle and renderer containment.

The packaged application leaves dependencies outside ASAR. Harness maintains package links from writable profile directories to its installed dependency graph; ASAR paths are virtual, read-only paths and cannot serve as real symlink targets.

Dive declares Harness's required peer packages as direct production dependencies. pnpm satisfies those peers inside its development store, but Electron Builder collects a flattened production graph and otherwise omits peers that the `@deepseek-ai/dsh` manifest does not name directly.

## Security and failure behavior

The renderer has Node integration disabled, context isolation and sandboxing enabled, and no preload bridge. The window stays on the exact Harness origin. HTTPS links may open in the operating system browser; other cross-origin targets and permission requests are denied.

Startup fails if Harness exits, prints no valid URL before the timeout, or provides no piped output. Closing Dive sends the child process a graceful termination request and waits for a bounded interval, then force-terminates a child that does not exit. An unexpected runtime exit is a fatal desktop error rather than a silent disconnected window.

## Alternatives considered

**Tauri with a Node sidecar.** Tauri reduces the renderer footprint but cannot host the Node-based Harness directly. Shipping and supervising a separate Node runtime adds a Rust-to-Node process bridge, sidecar packaging for every platform, and another compatibility layer without replacing the official Web transport.

**Electron `utilityProcess`.** The Chromium Node service did not retain the Harness HTTP listener in a real application run: the CLI announced its bound port, then the service exited before the renderer could connect. An ordinary Node child retains the long-lived server and gives Harness, PTY, Shell, and descendant processes the process semantics they use in the CLI distribution.

**A BrowserWindow around a user-managed localhost server.** This keeps the desktop code smaller but is not a self-contained client. It retains the installation, port, startup-order, stale-process, and shutdown problems the desktop app is intended to remove.

**Copying the Harness frontend into Dive.** The Web application receives a boot manifest and runtime client-plugin modules from the Harness server, so a copied static shell would drift from the host package graph. Loading the official Web profile keeps both sides on one released version.

## Consequences

Dive inherits Electron's distribution size and must track Electron security releases. It also tracks a pinned Harness prerelease. In return, the desktop package uses the same JavaScript runtime family as Harness, preserves the official UI and API transport, isolates user data, and can build installers without asking users to install or supervise Node.js.
