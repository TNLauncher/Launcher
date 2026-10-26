import { useQuery } from "@tanstack/react-query";
import { launcher } from "@/api/launcher";
import { sources } from "@/api/sources";
import { Button, Chip, Icon, IconButton } from "@/components/ui";
import { cx } from "@/lib/cx";
import { InstanceContent } from "@/features/content/InstanceContent";
import { UpdateDialog } from "@/features/content/UpdateDialog";
import { useInstanceBulkUpdate } from "@/features/content/useContent";
import { lastPlayed, LOADER_ICON, loaderLabel, playTime } from "@/lib/format";
import { useSourceEnabled } from "@/hooks/useSource";
import { useLauncher } from "@/store/LauncherContext";
import { repair } from "@/store/repair";
import { useUi } from "@/store/UiContext";
import { useBackLabel } from "@/components/layout/Sidebar";
import type { Instance } from "@/types";
// The page reuses the modpack hero.
import s from "@/features/modpacks/modpacks.module.css";

/** One instance: header with launch, then its mods, resource packs and shaders. */
export function InstancePage({ instance: i, onBack }: { instance: Instance; onBack(): void }) {
  const launch = useLauncher((st) => st.launch);
  const running = useLauncher((st) => st.snapshot?.running.includes(i.id) ?? false);
  const starting = useLauncher((st) => st.busyId === i.id);
  const busy = useLauncher((st) => st.busyId !== null);
  const contentDetailOpen = useUi((st) => st.route.content?.instanceId === i.id);
  const bulkUpdate = useInstanceBulkUpdate(i);
  const ref = i.pack;
  const sourceOn = useSourceEnabled(ref?.source);
  const pack = useQuery({ queryKey: ["project", ref?.source, ref?.project], queryFn: () => sources.project(ref!.source, ref!.project), enabled: !!ref && sourceOn });
  const banner = pack.data?.gallery.find((g) => g.featured)?.url ?? pack.data?.gallery[0]?.url;
  const icon = i.icon || pack.data?.iconUrl;
  const color = pack.data?.color;
  const backLabel = useBackLabel();

  return (
    <div className={cx(s.packPage, s.instancePage)} style={color != null ? ({ "--pack": `#${color.toString(16).padStart(6, "0")}` } as React.CSSProperties) : undefined}>
      <div className={s.packHero} hidden={contentDetailOpen}>
        {banner && <img className={s.packHeroBg} src={banner} alt="" />}
        <div className={s.packHeroInner}>
          <Button variant="overlay" size="sm" icon="arrow_back" className={s.packBack} onClick={onBack}>
            {backLabel}
          </Button>
          <div className={s.packHeroMain}>
            <span className={cx(s.packIcon, s.big)}>{icon ? <img src={icon} alt="" /> : <Icon name={LOADER_ICON[i.loader]} />}</span>
            <div className={s.packHeroText}>
              <h1>{i.name}</h1>
              <div className={s.packMeta}>
                <Chip variant="tag">{i.version}</Chip>
                <Chip>{loaderLabel(i)}</Chip>
                {ref && (
                  <Chip variant="ghost" icon="inventory_2">
                    {pack.data?.title ?? "Modpack"} {ref.version}
                  </Chip>
                )}
                <span className={s.stat}>{lastPlayed(i.lastPlayed)}</span>
                {i.playSeconds > 0 && <span className={s.stat}>{playTime(i.playSeconds)}</span>}
              </div>
            </div>
            <div className={s.instanceActions}>
              {bulkUpdate.canUpdate && (
                <Button
                  variant="overlay"
                  icon="upgrade"
                  loading={bulkUpdate.checking || bulkUpdate.busy}
                  disabled={running}
                  title="Check mods, resource packs and shaders for updates"
                  onClick={bulkUpdate.check}
                >
                  Update all
                </Button>
              )}
              <UpdateDialog candidates={bulkUpdate.candidates} onClose={bulkUpdate.dismiss} onConfirm={bulkUpdate.apply} />
              <Button variant="overlay" icon="healing" title="Repair files and find what stops this instance from starting" onClick={() => repair.focus(i.id)}>
                Repair
              </Button>
              <IconButton icon="folder_open" label="Open instance folder" variant="overlay" onClick={() => launcher.openInstanceDir(i.id)} />
              <Button variant="primary" size="lg" icon="play_arrow" loading={starting} disabled={running || busy} onClick={() => launch(i.id)}>
                {running ? "Running" : starting ? "Starting" : "Play"}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className={cx(!contentDetailOpen && s.instanceBody)}>
        <InstanceContent key={i.id} instance={i} />
      </div>
    </div>
  );
}
