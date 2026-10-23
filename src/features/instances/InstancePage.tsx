import { useQuery } from "@tanstack/react-query";
import { launcher } from "@/api/launcher";
import { getProject } from "@/api/modrinth";
import { Icon } from "@/components/ui/Icon";
import { InstanceContent } from "@/features/content/InstanceContent";
import { lastPlayed, LOADER_ICON, loaderLabel, playTime } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { Instance } from "@/types";
import "@/features/modpacks/modpacks.css";

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
    <div className="pack-page instance-page" style={color != null ? ({ "--pack": `#${color.toString(16).padStart(6, "0")}` } as React.CSSProperties) : undefined}>
      <div className="pack-hero">
        {banner && <img className="pack-hero-bg" src={banner} alt="" />}
        <div className="pack-hero-inner">
          <button className="btn small pack-back" onClick={onBack}>
            <Icon name="arrow_back" />
            Instances
          </button>
          <div className="pack-hero-main">
            <span className="pack-icon big">{icon ? <img src={icon} alt="" /> : <Icon name={LOADER_ICON[i.loader]} />}</span>
            <div className="pack-hero-text">
              <h1>{i.name}</h1>
              <div className="pack-meta">
                <span className="chip tag">{i.version}</span>
                <span className="chip">{loaderLabel(i)}</span>
                {i.modpackId && (
                  <span className="chip ghost">
                    <Icon name="inventory_2" />
                    {pack.data?.title ?? "Modpack"} {i.modpackVersion}
                  </span>
                )}
                <span>{lastPlayed(i.lastPlayed)}</span>
                {i.playSeconds > 0 && <span>{playTime(i.playSeconds)}</span>}
              </div>
            </div>
            <div className="instance-actions">
              <button className="icon-btn" title="Open instance folder" aria-label="Open instance folder" onClick={() => launcher.openInstanceDir(i.id)}>
                <Icon name="folder_open" />
              </button>
              <button className="btn primary instance-play" disabled={running || !!busyId} onClick={() => launch(i.id)}>
                <Icon name={starting ? "progress_activity" : "play_arrow"} fill spin={starting} />
                {running ? "Running" : starting ? "Starting" : "Play"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="instance-body">
        <InstanceContent key={i.id} instance={i} />
      </div>
    </div>
  );
}
