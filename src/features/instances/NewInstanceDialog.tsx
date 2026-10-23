import { useEffect, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { getVersions, type ManifestVersion } from "@/api/mojang";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, LOADERS } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Loader } from "@/types";
import { Select } from "@/components/ui/Select";

/** Mounted only while open, so every opening starts from fresh state. */
export function NewInstanceDialog() {
  const { closeNewInstance, navigate } = useUi();
  const { refresh, select } = useLauncher();
  const ref = useRef<HTMLDialogElement>(null);
  const [versions, setVersions] = useState<ManifestVersion[] | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [loader, setLoader] = useState<Loader>("vanilla");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
    getVersions().then(setVersions, (e) => setError(`Could not load versions: ${errorMessage(e)}`));
  }, []);

  const shown = (versions ?? []).filter((v) => v.type === "release" || (snapshots && v.type === "snapshot"));
  const chosen = shown.some((v) => v.id === version) ? version : (shown[0]?.id ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setCreating(true);
    setError("");
    try {
      const inst = await launcher.createInstance(name, chosen, loader);
      select(inst.id);
      await refresh();
      closeNewInstance();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <dialog ref={ref} aria-labelledby="new-instance-title" onClose={closeNewInstance}>
      <form onSubmit={submit}>
        <div className="dialog-head">
          <h2 id="new-instance-title">New instance</h2>
          <button
            type="button"
            className="link"
            onClick={() => {
              closeNewInstance();
              navigate("modpacks");
            }}
          >
            Start from a modpack
          </button>
        </div>
        <label className="field">
          <span>Name</span>
          <input className="input" placeholder={chosen || "My world"} maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Minecraft version</span>
          <div className="row-inline">
            <Select label="Minecraft version" style={{ flex: 1 }} value={chosen} onChange={setVersion}
              placeholder={versions ? "No versions" : "Loading versions…"}
              options={shown.map((v) => ({ value: v.id, label: v.id, hint: v.type === "snapshot" ? "snapshot" : undefined }))} />
            <label className="check">
              <input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} />
              Snapshots
            </label>
          </div>
        </div>
        <div className="field">
          <span>Mod loader</span>
          <div className="seg">
            {(Object.keys(LOADERS) as Loader[]).map((l) => (
              <button key={l} type="button" className="pill" aria-pressed={loader === l} onClick={() => setLoader(l)}>
                {LOADERS[l]}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div className="banner">
            <div className="msg"><Icon name="error" size={18} /><span>{error}</span></div>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={closeNewInstance}>Cancel</button>
          <button type="submit" className="btn primary" disabled={creating || !chosen}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
