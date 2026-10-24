import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { launcher } from "@/api/launcher";
import { getVersions, type ManifestVersion } from "@/api/mojang";
import { Banner, Button, Dialog, Icon, Input, Select, Switch, toast } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage, LOADER_ICON, LOADERS } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Loader } from "@/types";
import s from "./NewInstanceDialog.module.css";

const LOADER_HINT: Record<Loader, string> = {
  vanilla: "The game, no mods",
  fabric: "Lightweight, quick to update",
  quilt: "Fabric fork, runs most Fabric mods",
  forge: "Classic, the biggest mod library",
  neoforge: "Modern Forge, 1.20.2 and up",
  liteloader: "Legacy, up to 1.12.2",
};
const PRERELEASE = /alpha|beta|rc|pre|snapshot/i;

/** Mounted only while open, so every opening starts from fresh state. */
export function NewInstanceDialog() {
  const { closeNewInstance, navigate } = useUi();
  const { refresh, select } = useLauncher();
  const [versions, setVersions] = useState<ManifestVersion[] | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [loader, setLoader] = useState<Loader>("vanilla");
  const [build, setBuild] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getVersions().then(setVersions, (e) => setError(`Could not load versions: ${errorMessage(e)}`));
  }, []);

  const modded = loader !== "vanilla";
  const loaderName = LOADERS[loader];
  // The game versions this loader runs; Mojang's manifest stays the source of order and release type.
  const games = useQuery({ queryKey: ["loaderGames", loader], queryFn: () => launcher.loaderGames(loader), enabled: modded });
  const supported = modded ? (games.data ? new Set(games.data) : null) : undefined;
  const shown = supported === null ? [] : (versions ?? []).filter((v) => (v.type === "release" || (snapshots && v.type === "snapshot")) && (!supported || supported.has(v.id)));
  const chosen = shown.some((v) => v.id === version) ? version : (shown[0]?.id ?? "");

  const builds = useQuery({ queryKey: ["loaderBuilds", chosen, loader], queryFn: () => launcher.loaderBuilds(chosen, loader), enabled: modded && !!chosen });
  const recommended = builds.data?.find((b) => b.stable)?.version ?? builds.data?.[0]?.version ?? "";
  const chosenBuild = builds.data?.some((b) => b.version === build) ? build : recommended;
  const fallbackName = modded ? `${chosen} ${loaderName}` : chosen;
  const versionsLoading = !versions || (modded && games.isPending);

  async function submit() {
    if (!chosen || (modded && !chosenBuild)) return;
    setCreating(true);
    setError("");
    try {
      const inst = await launcher.createInstance(name.trim() || fallbackName, chosen, loader, modded ? chosenBuild : null);
      select(inst.id);
      await refresh();
      closeNewInstance();
      toast(`${inst.name} created`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open
      className={s.dialog}
      title="New instance"
      onClose={closeNewInstance}
      onSubmit={submit}
      aside={
        <Button
          variant="link"
          onClick={() => {
            closeNewInstance();
            navigate("modpacks");
          }}
        >
          Start from a modpack
        </Button>
      }
      actions={
        <>
          <Button onClick={closeNewInstance}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={creating || !chosen || (modded && !chosenBuild)}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div className={s.body}>
        <fieldset className={s.loaders}>
          <legend className={s.label}>Mod loader</legend>
          {(Object.keys(LOADERS) as Loader[]).map((l) => (
            <label key={l} className={cx(s.loader, "sheen")}>
              <input type="radio" name="loader" value={l} checked={loader === l} onChange={() => setLoader(l)} />
              <span className={s.loaderIcon}><Icon name={LOADER_ICON[l]} /></span>
              <span className={s.loaderText}>
                <span className={s.loaderName}>{LOADERS[l]}</span>
                <span className={s.loaderHint}>{LOADER_HINT[l]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className={s.side}>
          <label className={s.field}>
            <span className={s.labelRow}>
              <span className={s.label}>Name</span>
              <span className={s.optional}>Optional</span>
            </span>
            <Input placeholder={fallbackName || "My world"} maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className={s.versions}>
            <div className={s.field}>
              <div className={s.labelRow}>
                <span className={s.label}>Minecraft version</span>
                <label className={s.snap}>
                  Snapshots
                  <Switch checked={snapshots} onChange={setSnapshots} label="Show snapshots" />
                </label>
              </div>
              <Select label="Minecraft version" value={chosen} onChange={setVersion}
                placeholder={versionsLoading ? "Loading versions…" : modded ? `No versions with ${loaderName}` : "No versions"}
                options={shown.map((v) => ({ value: v.id, label: v.id, hint: v.type === "snapshot" ? "snapshot" : undefined }))} />
              {!modded ? (
                <p className={s.status}><Icon name="deployed_code" />Plain Minecraft, as Mojang ships it</p>
              ) : (
                games.isSuccess && <p className={s.status}><Icon name="filter_alt" />Only versions {loaderName} supports</p>
              )}
            </div>

            {modded && (
              <div className={s.field}>
                <span className={s.label}>{loaderName} version</span>
                <Select label={`${loaderName} version`} value={chosenBuild} onChange={setBuild}
                  placeholder={!chosen ? "Pick a Minecraft version" : builds.isPending ? "Loading builds…" : `No ${loaderName} builds`}
                  options={(builds.data ?? []).map((b) => ({
                    value: b.version,
                    label: b.version,
                    hint: b.version === recommended ? "recommended" : PRERELEASE.test(b.version) ? "beta" : undefined,
                  }))} />
              </div>
            )}
          </div>
        </div>
      </div>
      {games.isError && <Banner message={`Could not load ${loaderName} versions: ${errorMessage(games.error)}`} onRetry={() => games.refetch()} />}
      {builds.isError && <Banner message={`Could not load ${loaderName} builds: ${errorMessage(builds.error)}`} onRetry={() => builds.refetch()} />}
      {error && <Banner message={error} />}
    </Dialog>
  );
}
