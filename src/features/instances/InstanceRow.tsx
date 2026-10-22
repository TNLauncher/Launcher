import { useState } from "react";
import { launcher } from "@/api/launcher";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, lastPlayed, LOADER_ICON, loaderLabel, playTime, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Instance } from "@/types";

export function InstanceRow({ instance: i }: { instance: Instance }) {
  const { launch, busyId, isRunning, refresh, snapshot } = useLauncher();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowError, setRowError] = useState("");
  const running = isRunning(i.id);
  const starting = busyId === i.id;

  const run = (action: () => Promise<unknown>) =>
    action()
      .then(() => setRowError(""))
      .catch((e) => setRowError(errorMessage(e)))
      .finally(refresh);

  const rename = (name: string) => {
    setEditing(false);
    if (name.trim() && name.trim() !== i.name) run(() => launcher.renameInstance(i.id, name));
  };

  return (
    <div className="row">
      <div className="row-main">
        <div className="row-icon">
          <Icon name={LOADER_ICON[i.loader]} />
          {running && <span className="dot blue" />}
        </div>
        <div className="row-text">
          <div className="row-title">
            {editing ? (
              <input
                className="input inline-input"
                defaultValue={i.name}
                autoFocus
                maxLength={48}
                aria-label="Instance name"
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(e.currentTarget.value);
                  if (e.key === "Escape") setEditing(false);
                }}
              />
            ) : (
              <strong>{i.name}</strong>
            )}
            <span className="chip tag">{i.version}</span>
            <span className="chip">{loaderLabel(i)}</span>
          </div>
          <div className="meta small">
            {rowError ? (
              <span style={{ color: "var(--critical)" }}>{rowError}</span>
            ) : (
              <>
                <span>{lastPlayed(i.lastPlayed)}</span>
                {i.playSeconds > 0 && (
                  <>
                    <span className="sep">•</span>
                    <span>{playTime(i.playSeconds)}</span>
                  </>
                )}
                {i.loader !== "vanilla" && (
                  <>
                    <span className="sep">•</span>
                    <span>{plural(snapshot?.modCounts[i.id] ?? 0, "mod")}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="row-actions">
        <button className="btn" disabled={running || !!busyId} onClick={() => launch(i.id)}>
          <Icon name={starting ? "progress_activity" : "play_arrow"} fill spin={starting} />
          {running ? "Running" : starting ? "Starting" : "Launch"}
        </button>
        <div className="group">
          <button className="icon-btn" title="Open folder" onClick={() => run(() => launcher.openInstanceDir(i.id))}>
            <Icon name="folder_open" />
          </button>
          <button className="icon-btn" title="Rename" onClick={() => setEditing(true)}>
            <Icon name="edit" />
          </button>
          <button className="icon-btn danger" title="Delete" disabled={running} onClick={() => setConfirmDelete(true)}>
            <Icon name="delete" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${i.name}”?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          run(() => launcher.deleteInstance(i.id));
        }}
      >
        Its worlds, mods and settings will be removed from disk. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
