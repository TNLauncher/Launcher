import { useQuery } from "@tanstack/react-query";
import { launcher } from "@/api/launcher";
import { sources } from "@/api/sources";
import hero from "@/assets/hero.jpg";
import { Button, Icon, Meta } from "@/components/ui";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { useSourceEnabled } from "@/hooks/useSource";
import { loaderIcon, loaderLabel } from "@/lib/format";
import { useLauncher, useSelectedInstance } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance } from "@/types";
import s from "./home.module.css";

/** The armed instance, staged on its newest screenshot, else its modpack's cover, else the bundled scene. */
export function Hero() {
  const inst = useSelectedInstance();
  const loaded = useLauncher((st) => st.snapshot !== null);
  const openNewInstance = useUi((st) => st.openNewInstance);

  if (!inst) {
    return (
      <div className={`${s.cell} ${s.stage}`}>
        <img className={s.stageBg} src={hero} alt="" />
        <div className={s.stageBody}>
          {loaded && (
            <>
              <h1>No instances yet</h1>
              <Meta items={["Create one to download Minecraft and start playing."]} />
              <div className={s.stageCta}>
                <Button variant="primary" icon="add" onClick={openNewInstance}>Create instance</Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  return <Stage inst={inst} />;
}

function Stage({ inst }: { inst: Instance }) {
  const navigate = useUi((st) => st.navigate);
  const running = useLauncher((st) => st.snapshot?.running.includes(inst.id) ?? false);
  const shots = useQuery({ queryKey: ["screenshots", inst.id], queryFn: () => launcher.listScreenshots(inst.id) });
  const newest = shots.data?.[0];
  const shot = useBlobUrl(newest ? `${inst.id}/${newest.file}` : null, () => launcher.screenshot(inst.id, newest!.file));
  const ref = inst.pack;
  const sourceOn = useSourceEnabled(ref?.source);
  // Same key as the instance page, so the cover is shared from cache.
  const pack = useQuery({ queryKey: ["project", ref?.source, ref?.project], queryFn: () => sources.project(ref!.source, ref!.project), enabled: !!ref && sourceOn });
  const cover = pack.data?.gallery.find((g) => g.featured)?.url ?? pack.data?.gallery[0]?.url;
  // Hold the frame empty until we know what is there, so the bundled scene never flashes first.
  const waiting = shots.isPending || (newest && !shots.isError) || pack.isLoading;
  const bg = shot ?? (waiting ? null : (cover ?? hero));

  return (
    <div className={`${s.cell} ${s.stage}`}>
      {bg && <img key={bg} className={s.stageBg} src={bg} alt="" />}
      <div className={s.stageTop}>
        {running && <span className={s.live}>In game</span>}
        <Button variant="overlay" size="sm" icon="open_in_new" onClick={() => navigate("instances", { instance: inst.id })}>
          Open
        </Button>
      </div>
      <div className={s.stageBody}>
        <span className={s.stageIcon}>{inst.icon ? <img src={inst.icon} alt="" /> : <Icon name={loaderIcon(inst)} />}</span>
        <h1>{inst.name}</h1>
        <Meta items={[<span>Minecraft {inst.version}</span>, <span>{loaderLabel(inst)}</span>]} />
      </div>
    </div>
  );
}
