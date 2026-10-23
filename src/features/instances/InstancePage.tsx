import { useQuery } from "@tanstack/react-query";
import { launcher } from "@/api/launcher";
import { getProject } from "@/api/modrinth";
import { Button, Chip, Icon, IconButton } from "@/components/ui";
import { cx } from "@/lib/cx";
import { InstanceContent } from "@/features/content/InstanceContent";
import { lastPlayed, LOADER_ICON, loaderLabel, playTime } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Instance } from "@/types";
// The page reuses the modpack hero.
import s from "@/features/modpacks/modpacks.module.css";

/** One instance: header with launch, then its mods, resource packs and shaders. */
export function InstancePage({ instance: i, onBack }: { instance: Instance; onBack(): void }) {
  const { launch, busyId, isRunning } = useLauncher();
  const pack = useQuery({ queryKey: ["project", i.modpackId], queryFn: () => getProject(i.modpackId), enabled: !!i.modpackId });
  const banner = pack.data?.gallery.find((g) => g.featured)?.url ?? pack.data?.gallery[0]?.url;
  const icon = i.icon || pack.data?.icon_url;
  const running = isRunning(i.id);
  const starting = busyId === i.id;
  const color = pack.data?.color;

  return (
    <div className={cx(s.packPage, s.instancePage)} style={color != null ? ({ "--pack": `#${color.toString(16).padStart(6, "0")}` } as React.CSSProperties) : undefined}>
      <div className={s.packHero}>
        {banner && <img className={s.packHeroBg} src={banner} alt="" />}
        <div className={s.packHeroInner}>
          <Button variant="overlay" size="sm" icon="arrow_back" className={s.packBack} onClick={onBack}>
            Instances
          </Button>
          <div className={s.packHeroMain}>
            <span className={cx(s.packIcon, s.big)}>{icon ? <img src={icon} alt="" /> : <Icon name={LOADER_ICON[i.loader]} />}</span>
            <div className={s.packHeroText}>
              <h1>{i.name}</h1>
              <div className={s.packMeta}>
                <Chip variant="tag">{i.version}</Chip>
                <Chip>{loaderLabel(i)}</Chip>
                {i.modpackId && (
                  <Chip variant="ghost" icon="inventory_2">
                    {pack.data?.title ?? "Modpack"} {i.modpackVersion}
                  </Chip>
                )}
                <span className={s.stat}>{lastPlayed(i.lastPlayed)}</span>
                {i.playSeconds > 0 && <span className={s.stat}>{playTime(i.playSeconds)}</span>}
              </div>
            </div>
            <div className={s.instanceActions}>
              <IconButton icon="folder_open" label="Open instance folder" variant="overlay" onClick={() => launcher.openInstanceDir(i.id)} />
              <Button variant="primary" size="lg" icon="play_arrow" loading={starting} disabled={running || !!busyId} onClick={() => launch(i.id)}>
                {running ? "Running" : starting ? "Starting" : "Play"}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className={s.instanceBody}>
        <InstanceContent key={i.id} instance={i} />
      </div>
    </div>
  );
}
