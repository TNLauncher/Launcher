import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { launcher } from "@/api/launcher";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { Banner, Button, ConfirmDialog, EmptyState, Icon, IconButton, Skeleton, toast } from "@/components/ui";
import { errorMessage, lastPlayed } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Instance, World } from "@/types";
import s from "./worlds.module.css";

/** The instance's `saves/` folder: play a world straight away, copy or delete it. */
export function Worlds({ instance }: { instance: Instance }) {
  const id = instance.id;
  const worlds = useQuery({ queryKey: ["worlds", id], queryFn: () => launcher.listWorlds(id) });
  const launch = useLauncher((st) => st.launch);
  const running = useLauncher((st) => st.snapshot?.running.includes(id) ?? false);
  const busy = useLauncher((st) => st.busyId !== null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const list = worlds.data ?? [];

  const act = (action: Promise<unknown>) =>
    action
      .then(() => setError(""))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => worlds.refetch());

  const copy = (folder: string) => {
    setCopying(folder);
    act(launcher.copyWorld(id, folder).then((name) => toast(`Copied as ${name}`, "info", "content_copy"))).finally(() => setCopying(null));
  };

  return (
    <section className={s.pane} aria-label="Worlds">
      <div className={s.head}>
        <h3>Worlds</h3>
        {worlds.data && <span className="mono">{list.length}</span>}
        <IconButton icon="folder_open" label="Open saves folder" className={s.folder} onClick={() => act(launcher.openInstanceDir(id, "saves"))} />
      </div>
      {(error || worlds.error) && <Banner message={error || errorMessage(worlds.error)} onDismiss={() => setError("")} />}

      {!worlds.data ? (
        Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={64} />)
      ) : !list.length ? (
        <EmptyState icon="public">No worlds yet. Create one in game and it shows up here.</EmptyState>
      ) : (
        <div className={s.list}>
          {list.map((w) => (
            <div key={w.folder} className={s.world}>
              <WorldIcon instanceId={id} world={w} />
              <div className={s.text}>
                <strong>{w.folder}</strong>
                <span>{lastPlayed(w.played)}</span>
              </div>
              <div className={s.actions}>
                <IconButton icon="content_copy" label={`Copy ${w.folder}`} title="Make a copy (backup)" disabled={copying === w.folder} onClick={() => copy(w.folder)} />
                <IconButton icon="delete" label={`Delete ${w.folder}`} variant="danger" disabled={running} onClick={() => setRemoving(w.folder)} />
                <Button icon="play_arrow" disabled={running || busy} title="Launch the game straight into this world (Minecraft 1.20+)" onClick={() => launch(id, w.folder)}>
                  Play
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        title={`Delete “${removing}”?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) act(launcher.deleteWorld(id, removing));
          setRemoving(null);
        }}
      >
        The world is removed from disk. This cannot be undone. Make a copy first if you may want it back.
      </ConfirmDialog>
    </section>
  );
}

function WorldIcon({ instanceId, world: w }: { instanceId: string; world: World }) {
  const src = useBlobUrl(w.icon ? `${instanceId}/${w.folder}/${w.played}` : null, () => launcher.worldIcon(instanceId, w.folder));
  return <span className={s.icon}>{src ? <img src={src} alt="" /> : <Icon name="public" />}</span>;
}
