import { useCallback, useEffect, useState, type ReactNode } from "react";
import { launcher } from "@/api/launcher";
import { Banner } from "@/components/ui/Banner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
import { errorMessage, megabytes } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Instance, ModFile } from "@/types";

const displayName = (file: string) => file.replace(/\.jar(\.disabled)?$/, "");

export function InstalledMods({ instance, picker }: { instance: Instance; picker: ReactNode }) {
  const { refresh } = useLauncher();
  const [mods, setMods] = useState<ModFile[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<ModFile | null>(null);

  const reload = useCallback(() => launcher.listMods(instance.id).then(setMods, (e) => setError(errorMessage(e))), [instance.id]);
  useEffect(() => void reload(), [reload]);

  const act = (action: Promise<void>) =>
    action
      .then(() => setError(""))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => {
        reload();
        refresh();
      });

  const q = filter.trim().toLowerCase();
  const shown = (mods ?? []).filter((m) => m.file.toLowerCase().includes(q));

  return (
    <div className="pane">
      <div className="pane-head">
        <div className="top">
          <div className="pane-title">
            Installed mods <span className="mono muted">{mods?.length ?? ""}</span>
          </div>
          {picker}
        </div>
        <label className="search">
          <Icon name="search" />
          <input className="input" placeholder="Filter installed mods" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {error && <Banner message={error} onDismiss={() => setError("")} />}
      </div>

      <div className="pane-list">
        {!mods ? (
          <div className="skeleton" style={{ height: 64 }} />
        ) : !mods.length ? (
          <EmptyState icon="inventory_2">No mods yet. Find some on the right.</EmptyState>
        ) : (
          shown.map((m) => (
            <div key={m.file} className={`mod ${m.enabled ? "" : "off"}`}>
              <div className="mod-main">
                <div className="mod-icon">
                  <Icon name="extension" />
                  <img
                    src={launcher.modIconUrl(instance.id, m.file)}
                    alt=""
                    loading="lazy"
                    onError={(e) => e.currentTarget.remove()}
                  />
                </div>
                <div className="mod-text">
                  <div className="mod-name">
                    {displayName(m.file)}
                    {!m.enabled && <span className="chip">Disabled</span>}
                  </div>
                  <span className="mono subtle">{megabytes(m.size)}</span>
                </div>
              </div>
              <div className="mod-side">
                <button className="icon-btn danger" title="Remove" onClick={() => setRemoving(m)}>
                  <Icon name="delete" />
                </button>
                <Switch
                  label={m.enabled ? "Disable" : "Enable"}
                  checked={m.enabled}
                  onChange={() => act(launcher.toggleMod(instance.id, m.file))}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="pane-foot">
        <button className="btn" onClick={() => act(launcher.openInstanceDir(instance.id, true))}>
          <Icon name="folder_open" className="muted" />
          Open mods folder
        </button>
      </div>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing ? displayName(removing.file) : ""}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) act(launcher.deleteMod(instance.id, removing.file));
          setRemoving(null);
        }}
      >
        The jar is deleted from this instance's mods folder.
      </ConfirmDialog>
    </div>
  );
}
