import { useQuery } from "@tanstack/react-query";
import { launcher } from "@/api/launcher";
import hero from "@/assets/hero.jpg";
import { Button, Icon, Meta } from "@/components/ui";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { loaderIcon, loaderLabel } from "@/lib/format";
import { useLauncher, useSelectedInstance } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance } from "@/types";
import s from "./home.module.css";

/** The armed instance, staged on its newest screenshot (the bundled scene when it has none). */
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
  // Hold the frame empty until we know whether there is a screenshot, so the bundled scene never flashes first.
  const bg = shot ?? (shots.isPending || (newest && !shots.isError) ? null : hero);

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
