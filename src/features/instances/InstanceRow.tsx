import { useState } from "react";
import { launcher } from "@/api/launcher";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, lastPlayed, LOADER_ICON, loaderLabel, playTime, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance } from "@/types";

const ICON_PX = 128;

/** Center-crops and downscales a picked image to a small data URL the backend will store. */
async function toIcon(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, ICON_PX, ICON_PX);
  img.close();
  return canvas.toDataURL("image/webp", 0.9);
}

export function InstanceRow({ instance: i, onOpen }: { instance: Instance; onOpen(): void }) {
  const { launch, busyId, isRunning, refresh, snapshot, select } = useLauncher();
  const { navigate } = useUi();
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
        <label className="row-icon" title="Change icon">
          {i.icon ? <img src={i.icon} alt="" /> : <Icon name={LOADER_ICON[i.loader]} />}
          {running && <span className="dot blue" />}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) run(async () => launcher.setInstanceIcon(i.id, await toIcon(file)));
            }}
          />
        </label>
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
              <button className="row-name" onClick={onOpen} title="Mods, resource packs and shaders">
                {i.name}
              </button>
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
          <button className="icon-btn" title="Console" onClick={() => (select(i.id), navigate("console"))}>
            <Icon name="terminal" />
          </button>
          <button className="icon-btn" title="Mods, resource packs and shaders" aria-label={`Manage ${i.name}`} onClick={onOpen}>
            <Icon name="widgets" />
          </button>
          <button className="icon-btn" title="Open folder" onClick={() => run(() => launcher.openInstanceDir(i.id))}>
            <Icon name="folder_open" />
          </button>
          {i.icon && (
            <button className="icon-btn" title="Reset icon" onClick={() => run(() => launcher.setInstanceIcon(i.id, ""))}>
              <Icon name="hide_image" />
            </button>
          )}
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
