import { useState } from "react";
import { launcher } from "@/api/launcher";
import { Button, Chip, ConfirmDialog, Dot, Icon, IconButton, Input, Meta, toast } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage, lastPlayed, LOADER_ICON, loaderLabel, playTime, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance } from "@/types";
import s from "./instances.module.css";

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
    // The name button stays the keyboard entry; this makes the rest of the card a click target too.
    <div
      className={cx(s.row, s.openable)}
      onClick={(e) => !(e.target as Element).closest("button, input, label, dialog") && onOpen()}
    >
      <div className={s.rowMain}>
        <label className={s.rowIcon} title="Change icon">
          {i.icon ? <img src={i.icon} alt="" /> : <Icon name={LOADER_ICON[i.loader]} />}
          {running && <Dot tone="blue" className={s.runningDot} />}
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
        <div className={s.rowText}>
          <div className={s.rowTitle}>
            {editing ? (
              <Input
                className={s.inlineInput}
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
              <button className={s.rowName} onClick={onOpen} title="Mods, resource packs and shaders">
                {i.name}
              </button>
            )}
            <Chip variant="tag">{i.version}</Chip>
            <Chip>{loaderLabel(i)}</Chip>
          </div>
          {rowError ? (
            <Meta small className={s.error} items={[rowError]} />
          ) : (
            <Meta
              small
              items={[
                lastPlayed(i.lastPlayed),
                i.playSeconds > 0 && playTime(i.playSeconds),
                i.loader !== "vanilla" && plural(snapshot?.modCounts[i.id] ?? 0, "mod"),
              ]}
            />
          )}
        </div>
      </div>

      <div className={s.rowActions}>
        <Button icon="play_arrow" loading={starting} disabled={running || !!busyId} onClick={() => launch(i.id)}>
          {running ? "Running" : starting ? "Starting" : "Launch"}
        </Button>
        <div className={s.group}>
          <IconButton icon="terminal" label="Console" onClick={() => (select(i.id), navigate("console"))} />
          <IconButton icon="widgets" label={`Manage ${i.name}`} title="Mods, resource packs and shaders" onClick={onOpen} />
          <IconButton icon="folder_open" label="Open folder" onClick={() => run(() => launcher.openInstanceDir(i.id))} />
          {i.icon && <IconButton icon="hide_image" label="Reset icon" onClick={() => run(() => launcher.setInstanceIcon(i.id, ""))} />}
          <IconButton icon="edit" label="Rename" onClick={() => setEditing(true)} />
          <IconButton icon="delete" label="Delete" variant="danger" disabled={running} onClick={() => setConfirmDelete(true)} />
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
          run(() => launcher.deleteInstance(i.id).then(() => toast(`${i.name} deleted`, "info", "delete")));
        }}
      >
        Its worlds, mods and settings will be removed from disk. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
