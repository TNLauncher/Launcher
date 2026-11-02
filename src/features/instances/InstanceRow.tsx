import { memo, useEffect, useState } from "react";
import { launcher } from "@/api/launcher";
import { Button, Chip, ConfirmDialog, Dialog, Dot, Icon, IconButton, Input, Menu, Meta, toast } from "@/components/ui";
import { cx } from "@/lib/cx";
import { errorMessage, lastPlayed, loaderIcon, loaderLabel, playTime, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { openInstanceTab } from "@/store/instanceTab";
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

export const InstanceRow = memo(function InstanceRow({ instance: i, groups, onOpen }: { instance: Instance; groups: string[]; onOpen(id: string): void }) {
  const running = useLauncher((st) => st.snapshot?.running.includes(i.id) ?? false);
  const starting = useLauncher((st) => st.busyId === i.id);
  const busy = useLauncher((st) => st.busyId !== null);
  const modCount = useLauncher((st) => st.snapshot?.modCounts[i.id] ?? 0);
  const launch = useLauncher((st) => st.launch);
  const refresh = useLauncher((st) => st.refresh);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [rowError, setRowError] = useState("");
  const open = () => onOpen(i.id);

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
      className={cx(s.row, s.openable, "sheen")}
      onClick={(e) => !(e.target as Element).closest("button, input, label, dialog") && open()}
    >
      <div className={s.rowMain}>
        <label className={s.rowIcon} title="Change icon">
          {i.icon ? <img src={i.icon} alt="" /> : <Icon name={loaderIcon(i)} />}
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
              <button className={s.rowName} onClick={open} title="Mods, resource packs and shaders">
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
                i.loader !== "vanilla" && plural(modCount, "mod"),
              ]}
            />
          )}
        </div>
      </div>

      <div className={s.rowActions}>
        <Button icon="play_arrow" loading={starting} disabled={running || busy} onClick={() => launch(i.id)}>
          {running ? "Running" : starting ? "Starting" : "Launch"}
        </Button>
        {running && <IconButton icon="article" label="Logs" onClick={() => openInstanceTab(i.id, "logs")} />}
        <Menu
          label={`${i.name} actions`}
          items={[
            { icon: "folder_open", label: "Open folder", onSelect: () => run(() => launcher.openInstanceDir(i.id)) },
            ...(running ? [] : [{ icon: "article", label: "Logs", onSelect: () => openInstanceTab(i.id, "logs") }]),
            { icon: "edit", label: "Rename", divide: true, onSelect: () => setEditing(true) },
            { icon: "content_copy", label: "Duplicate", onSelect: () => run(() => launcher.copyInstance(i.id).then((c) => toast(`Copied as ${c.name}`, "info", "content_copy"))) },
            { icon: "folder", label: "Move to group…", onSelect: () => setGrouping(true) },
            ...(i.icon ? [{ icon: "hide_image", label: "Reset icon", onSelect: () => run(() => launcher.setInstanceIcon(i.id, "")) }] : []),
            { icon: "delete", label: "Delete…", danger: true, divide: true, disabled: running, onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </div>

      <GroupDialog
        open={grouping}
        current={i.group}
        groups={groups}
        onClose={() => setGrouping(false)}
        onSave={(g) => {
          setGrouping(false);
          if (g !== i.group) run(() => launcher.setInstanceGroup(i.id, g));
        }}
      />

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
});

/** Picks an existing group or names a new one; empty = ungrouped. */
function GroupDialog({ open, current, groups, onClose, onSave }: { open: boolean; current: string; groups: string[]; onClose(): void; onSave(group: string): void }) {
  const [value, setValue] = useState(current);
  useEffect(() => {
    if (open) setValue(current);
  }, [open, current]);
  return (
    <Dialog
      open={open}
      title="Move to group"
      onClose={onClose}
      onSubmit={() => onSave(value.trim())}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Move</Button>
        </>
      }
    >
      <Input
        list="instance-groups"
        aria-label="Group"
        placeholder="No group"
        maxLength={48}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <datalist id="instance-groups">
        {groups.map((g) => <option key={g} value={g} />)}
      </datalist>
    </Dialog>
  );
}
