import { useEffect, useState } from "react";
import { launcher } from "@/api/launcher";
import { getVersions, type ManifestVersion } from "@/api/mojang";
import { Banner, Button, Checkbox, Dialog, Field, Input, Pill, PillGroup, Select, toast } from "@/components/ui";
import { errorMessage, LOADERS } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Loader } from "@/types";
import s from "./instances.module.css";

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

  async function submit() {
    if (!chosen) return;
    setCreating(true);
    setError("");
    try {
      const inst = await launcher.createInstance(name, chosen, loader);
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
          <Button type="submit" variant="primary" disabled={creating || !chosen}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input placeholder={chosen || "My world"} maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Minecraft version" asLabel={false}>
        <div className={s.rowInline}>
          <Select label="Minecraft version" className={s.grow} value={chosen} onChange={setVersion}
            placeholder={versions ? "No versions" : "Loading versions…"}
            options={shown.map((v) => ({ value: v.id, label: v.id, hint: v.type === "snapshot" ? "snapshot" : undefined }))} />
          <Checkbox checked={snapshots} onChange={setSnapshots}>Snapshots</Checkbox>
        </div>
      </Field>
      <Field label="Mod loader" asLabel={false}>
        <PillGroup label="Mod loader">
          {(Object.keys(LOADERS) as Loader[]).map((l) => (
            <Pill key={l} pressed={loader === l} onClick={() => setLoader(l)}>
              {LOADERS[l]}
            </Pill>
          ))}
        </PillGroup>
      </Field>
      {error && <Banner message={error} />}
    </Dialog>
  );
}
