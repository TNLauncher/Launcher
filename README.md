# TNLauncher

A fast, lightweight desktop launcher for **Minecraft: Java Edition**, built with **Tauri 2** (Rust) and **React 19** (TypeScript).

---

## Features

- **Official Microsoft Authentication** — Sign in securely with your Microsoft account via OAuth 2.0 Device Code flow. Requires a valid, licensed copy of *Minecraft: Java Edition*.
- **Isolated Instances** — Create and manage separate game instances with per-instance memory, Java runtime, window size, environment variables, and wrapper commands.
- **Mod Loaders** — First-class support for **Vanilla**, **Fabric**, **Quilt**, **Forge**, **NeoForge**, and **LiteLoader**.
- **Automatic Java Runtimes** — Automatically downloads and verifies the official Mojang Java runtime required by each Minecraft version, or lets you specify a custom Java installation.
- **Content & Modpack Management** — Manage mods, resource packs, shaders, screenshots, and live game logs per instance.
- **Sandboxed Plugin System** — Extensible through isolated iframe plugins with strict Content Security Policy (CSP) and manifest-declared host/download permissions.

---

## Authentication & Security

TNLauncher **only supports official Microsoft accounts** with an active *Minecraft: Java Edition* license:

1. **OAuth 2.0 Device Code Flow** (`login.microsoftonline.com`) — Users authenticate directly in their system browser on Microsoft's official sign-in page. TNLauncher never sees or collects user passwords.
2. **Xbox Live & XSTS Token Exchange** (`user.auth.xboxlive.com`, `xsts.auth.xboxlive.com`) — Exchanges the Microsoft token for an Xbox Live token and XSTS authorization ticket.
3. **Minecraft Services Login & Ownership Verification** (`api.minecraftservices.com`) — Authenticates with Minecraft Services and verifies game ownership against `/minecraft/profile` before allowing any profile to be added or launched.

Unauthenticated or offline launches are not supported.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- Platform dependencies for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

### Development & Build

```sh
# Install frontend dependencies
npm install

# Run in development mode with hot reload
npm run tauri dev

# Build production installer / bundle
npm run tauri build

# Run typechecks and backend unit tests
npm run typecheck
cd src-tauri && cargo test
```

### Configuration

Environment variables are read from `.env` files in the project root (`.env` < `.env.local` < `.env.<mode>` < `.env.<mode>.local`):

| Variable | Description |
|---|---|
| `TN_MS_CLIENT_ID` | Microsoft Entra (Azure) Application Client ID for OAuth 2.0 Device Code sign-in |

---

## Architecture

```text
src/                         React 19 + TypeScript frontend
  api/                       Typed IPC wrappers for Tauri commands
  store/                     Zustand stores: backend state snapshot & UI navigation
  components/ui, layout      Design system components and application shell
  features/<screen>/         Feature views: Home, Profiles, Instances, Modpacks, Mods, Console, Settings
  plugins/                   Sandboxed iframe plugin host and postMessage bridge
  types/                     TypeScript mirrors of Rust domain models

src-tauri/src/               Rust backend (Tauri 2)
  commands/                  Thin #[tauri::command] IPC handlers
  services/                  Application use cases (accounts, instances, launcher, mods, modpacks, skins)
  minecraft/                 Mojang & mod loader metadata, OAuth2/XSTS auth, asset/library installer, JVM builder
  plugins/                   Plugin manifest validator, CSP host serving, and RPC bridge
  storage.rs                 Atomic JSON persistence
```

---

## Disclaimer

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**
>
> Minecraft is a trademark of Mojang Synergies AB. All Mojang and Microsoft assets, APIs, and trademarks remain the property of their respective owners.
