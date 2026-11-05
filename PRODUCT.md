# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Modders and power users of Minecraft: Java Edition. They keep many isolated instances (vanilla and modded, often from modpacks), switch between them often, and care about mods, logs, crash reports, and per-instance settings. Typical session: open the launcher, pick or confirm an instance, launch; when something breaks, go straight to logs.

## Product Purpose
A fast, lightweight desktop launcher (Tauri 2 + React 19) for Minecraft: Java Edition. Success: getting into the right instance in the fewest moves, and understanding an instance's state (loader, version, mods, last session) at a glance.

## Positioning
Lightweight native-feeling launcher with a strong core and optional features delivered as sandboxed iframe plugins (VSCode-like), official Microsoft auth only.

## Operating Context
Desktop window, dark UI, used repeatedly for short sessions. Instances, accounts/skins, modpacks, plugins, settings are separate views; Home is the first screen and hosts the fixed launch dock.

## Capabilities and Constraints
- Instances: name, version, loader (vanilla/fabric/quilt/forge/neoforge/liteloader), loader version, lastPlayed, playSeconds, created, icon, source modpack, group, per-instance settings (RAM, Java, wrapper…), mod counts.
- Worlds, screenshots, mods/resourcepacks/shaders per instance; logs and crash reports.
- Accounts: Microsoft (and plugin providers), skin texture with slim flag; 3D skin model already exists in Profiles.
- Offline launches are not supported.

## Brand Commitments
- Visual system is Fabric Graphite (`~/.config/fabric/DESIGN.md`, tokens in `src/styles/tokens.css`): restrained graphite neutrals, color only for state, system blue for action. User confirmed: stay within Graphite.
- UI copy is English.

## Evidence on Hand
- `src/assets/hero.jpg`, `logo.svg`, `mark.svg`.
- Mojang patch notes feed (`src/api/mojang.ts`).
- No user counts, testimonials, or benchmarks; do not invent any.

## Product Principles
1. Launching is the primary job; everything else on Home supports choosing and understanding what you launch.
2. Show real instance state, never decoration standing in for data.
3. Strong core, optional features as plugins.
4. Calm by default; color signals state.
