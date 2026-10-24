# TNLauncher

Minecraft launcher: Tauri 2 + React 19 + Vite. Vanilla, Fabric, Quilt, Forge, NeoForge and LiteLoader instances,
Java runtimes downloaded from Mojang. Only official Microsoft accounts owning a licensed copy of Minecraft: Java Edition are supported.

```sh
npm install
npm run tauri dev      # app with hot reload
npm run tauri build    # release bundle
cd src-tauri && cargo test                                   # unit tests
cd src-tauri && cargo test --test launch_e2e -- --ignored    # real install + launch (~800 MB)
```

## Configuration

`.env` in the project root feeds both sides, Vite-style: `.env` < `.env.local` < `.env.<mode>` <
`.env.<mode>.local` < shell. Mode is `development` for `tauri dev`, `production` for `tauri build`.
`VITE_*` reach the frontend (`import.meta.env`), `TN_*` are baked into the Rust binary (`src-tauri/src/config.rs`).
Put personal values in `*.local` files, they are git-ignored.

| Variable | |
|---|---|
| `TN_MS_CLIENT_ID` | Azure app id for Microsoft sign-in |

## Layout

```
src/                         React frontend
  api/                       the only place that talks to Tauri or remote APIs
    ipc.ts                   invoke wrapper, turns backend errors into BackendError
    launcher.ts              typed wrappers for every Rust command
    mojang.ts, modrinth.ts   remote JSON (fetched through Rust)
  store/                     React context: backend snapshot (LauncherContext), navigation (UiContext)
  components/ui, layout      shared building blocks and the app shell
  features/<screen>/         one folder per screen: components + its CSS
  styles/                    tokens and global CSS (Fabric Graphite design system)
  types/                     mirrors of the Rust models

src-tauri/src/               Rust backend (crate tnlauncher_lib)
  lib.rs                     builder: plugins, managed state, command registry
  commands/                  #[tauri::command] adapters, one file per feature
  services/                  use cases: instances, mods, launcher (install → spawn → watch)
  minecraft/                 protocol code, no Tauri types: version/loader metadata, java, install, command
  storage.rs                 JSON persistence (atomic writes)
  models/, state.rs, error.rs
src-tauri/tests/             integration tests against the public crate API
```

Dependencies only point downward: `commands → services → minecraft / storage → models`.
A new feature usually means one file in `services/`, one in `commands/`, its line in `lib.rs`,
a wrapper in `src/api/launcher.ts` and a folder in `src/features/`.

Errors cross IPC as `{ kind, message }` (`error.rs`). Launch progress streams over a
`tauri::ipc::Channel`; the game exiting is a global `game-exit` event.
