# Roadmap: features PrismLauncher has and we don't

The core stays small, like VSCode: generic APIs in the launcher, optional features in plugins
(TNLauncher-Plugins repo).

## Done

- **Core:** copy instance, instance groups, worlds tab (copy, delete, Quick Play into a world on 1.20+),
  importing a modpack archive from disk (any enabled source's `planPack` or an importer plugin reads it).
- **Core plugin API:** `contributes.importer` + `tn.importers.register`, `tn.instances.export` (the launcher
  asks where to save and writes the zip), `tn.content.hashes`.
- **Plugins:** `mclogs` (share the log or crash report through mclo.gs), `export` (`.mrpack` with
  Modrinth-hosted mods linked, Prism/MultiMC zip), `prism` (import Prism/MultiMC zips).

## Next

- Import from ATLauncher, Technic, FTB: importer plugins, no core changes needed.
- Servers in the worlds tab (`servers.dat` is NBT) and Quick Play into a server.
- World names from `level.dat` (NBT, gzip); now the folder name is shown.
- `.mrpack` export: CurseForge-hosted mods are copied into overrides; a CurseForge zip export could link them.

## Power users

1. **Pre-launch / post-exit commands** (we only have the wrapper command).
2. **Java manager**: detect installed JDKs, switch versions, download Adoptium/Azul.
3. **Shortcut / CLI launch**: `--launch <id>`, desktop shortcut.
4. **Datapacks** as a content kind (catalog + per-world).
5. **Component editor**: jar mods, LWJGL override, custom `version.json`.
6. **Several instances running at once** (check: `stop_game` takes no id).

## Small things

7. **Proxy** for downloads.
8. **Packwiz / auto-update** of a pack on launch.
9. **Offline accounts out of the box** (now plugin-only, on purpose).
