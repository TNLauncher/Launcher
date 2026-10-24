import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { launcher } from "@/api/launcher";
import { BackendError } from "@/api/ipc";
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

/** Mounted only while open, so every opening starts from fresh state. */
export function NewInstanceDialog() {
  const { closeNewInstance, navigate } = useUi();
  const { refresh, select } = useLauncher();
  const [versions, setVersions] = useState<ManifestVersion[] | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [loader, setLoader] = useState<Loader>("vanilla");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getVersions().then(setVersions, (e) => setError(`Could not load versions: ${errorMessage(e)}`));
  }, []);

  const shown = (versions ?? []).filter((v) => v.type === "release" || (snapshots && v.type === "snapshot"));
  const chosen = shown.some((v) => v.id === version) ? version : (shown[0]?.id ?? "");
  const modded = loader !== "vanilla";
  const check = useQuery({
    queryKey: ["loaderVersion", chosen, loader],
    queryFn: () => launcher.loaderVersion(chosen, loader),
    enabled: modded && !!chosen,
    retry: (n, e) => !(e instanceof BackendError && e.kind === "unsupported") && n < 1,
  });
  const unsupported = check.error instanceof BackendError && check.error.kind === "unsupported";
  const fallbackName = modded ? `${chosen} ${LOADERS[loader]}` : chosen;

  async function submit() {
    if (!chosen || unsupported) return;
    setCreating(true);
    setError("");
    try {
      const inst = await launcher.createInstance(name.trim() || fallbackName, chosen, loader);
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
          <Button type="submit" variant="primary" disabled={creating || !chosen || unsupported || (modded && check.isPending)}>
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
          <div className={s.field}>
            <div className={s.labelRow}>
              <span className={s.label}>Minecraft version</span>
              <label className={s.snap}>
                Snapshots
                <Switch checked={snapshots} onChange={setSnapshots} label="Show snapshots" />
              </label>
            </div>
            <Select label="Minecraft version" value={chosen} onChange={setVersion}
              placeholder={versions ? "No versions" : "Loading versions…"}
              options={shown.map((v) => ({ value: v.id, label: v.id, hint: v.type === "snapshot" ? "snapshot" : undefined }))} />
            <p className={s.status} aria-live="polite" data-tone={!modded ? "muted" : check.isSuccess ? "ok" : check.isError ? "bad" : "muted"}>
              {!modded ? (
                <><Icon name="deployed_code" />Plain Minecraft, as Mojang ships it</>
              ) : !chosen ? null : check.isPending ? (
                <><Icon name="progress_activity" spin />Looking up {LOADERS[loader]} for {chosen}…</>
              ) : check.isSuccess ? (
                <><Icon name="check_circle" fill />{LOADERS[loader]} {check.data} will be installed</>
              ) : unsupported ? (
                <><Icon name="block" />{errorMessage(check.error)}</>
              ) : (
                <><Icon name="wifi_off" />Could not check {LOADERS[loader]}: {errorMessage(check.error)}</>
              )}
            </p>
          </div>

          <label className={s.field}>
            <span className={s.labelRow}>
              <span className={s.label}>Name</span>
              <span className={s.optional}>Optional</span>
            </span>
            <Input placeholder={fallbackName || "My world"} maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
      </div>
      {error && <Banner message={error} />}
    </Dialog>
  );
}
