import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { launcher } from "@/api/launcher";
import { Banner, ConfirmDialog, Dialog, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { errorMessage, megabytes } from "@/lib/format";
import type { Screenshot } from "@/types";
import s from "./screenshots.module.css";

const taken = (sh: Screenshot) => new Date(sh.taken * 1000).toLocaleString();

/** The instance's `screenshots/` folder: a grid, and a viewer that steps through it. */
export function Screenshots({ instanceId }: { instanceId: string }) {
  const shots = useQuery({ queryKey: ["screenshots", instanceId], queryFn: () => launcher.listScreenshots(instanceId) });
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const list = shots.data ?? [];
  const index = list.findIndex((sh) => sh.file === open);
  const current = list[index];
  const step = (by: number) => list.length && setOpen(list[(index + by + list.length) % list.length].file);

  const remove = (file: string) =>
    launcher
      .deleteScreenshot(instanceId, file)
      .then(() => {
        setError("");
        // Show the next one instead of closing; close when it was the last.
        setOpen(list.length > 1 ? list[(index + 1) % list.length].file : null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => shots.refetch());

  return (
    <section className={s.pane} aria-label="Screenshots">
      <div className={s.head}>
        <h3>Screenshots</h3>
        {shots.data && <span className="mono">{list.length}</span>}
        <IconButton icon="folder_open" label="Open screenshots folder" className={s.folder} onClick={() => launcher.openInstanceDir(instanceId, "screenshots").catch((e) => setError(errorMessage(e)))} />
      </div>
      {(error || shots.error) && <Banner message={error || errorMessage(shots.error)} onDismiss={() => setError("")} />}

      {!shots.data ? (
        <div className={s.grid}>
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className={s.thumb} />)}
        </div>
      ) : !list.length ? (
        <EmptyState icon="photo_camera">No screenshots yet. Press F2 in game to take one.</EmptyState>
      ) : (
        <div className={s.grid}>
          {list.map((sh) => (
            <button key={sh.file} type="button" className={s.thumb} title={`${sh.file} · ${taken(sh)}`} onClick={() => setOpen(sh.file)}>
              {/* ponytail: full-size PNGs as thumbnails; generate small ones in Rust if big folders feel slow */}
              <img src={launcher.screenshotUrl(instanceId, sh.file)} alt={sh.file} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={!!current}
        onClose={() => setOpen(null)}
        className={s.viewer}
        aria-label="Screenshot viewer"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") step(-1);
          if (e.key === "ArrowRight") step(1);
        }}
      >
        {current && (
          <>
            <img src={launcher.screenshotUrl(instanceId, current.file)} alt={current.file} />
            <div className={s.bar}>
              <IconButton icon="chevron_left" label="Previous" variant="overlay" disabled={list.length < 2} onClick={() => step(-1)} />
              <span className={s.caption}>
                <b className="mono">{current.file}</b>
                <span>
                  {taken(current)} · {megabytes(current.size)} · {index + 1} / {list.length}
                </span>
              </span>
              <IconButton icon="chevron_right" label="Next" variant="overlay" disabled={list.length < 2} onClick={() => step(1)} />
              <IconButton icon="delete" label="Delete screenshot" variant="overlay" onClick={() => setRemoving(current.file)} />
              <IconButton icon="close" label="Close" variant="overlay" autoFocus onClick={() => setOpen(null)} />
            </div>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        title="Delete screenshot?"
        confirmLabel="Delete"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove(removing);
          setRemoving(null);
        }}
      >
        <span className="mono">{removing}</span> is deleted from the screenshots folder.
      </ConfirmDialog>
    </section>
  );
}
