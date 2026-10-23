import { Button, Meta } from "@/components/ui";
import { lastPlayed, loaderLabel, plural } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./home.module.css";

export function Hero() {
  const { selected: inst, snapshot } = useLauncher();
  const { openNewInstance } = useUi();

  return (
    <div className={s.hero}>
      <div className={s.heroBg} />
      <div className={s.heroBody}>
        {!inst ? (
          <>
            <h1>No instances yet</h1>
            <Meta items={["Create one to download Minecraft and start playing."]} />
            <div className={s.heroCta}>
              <Button variant="primary" icon="add" onClick={openNewInstance}>
                Create instance
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1>{inst.name}</h1>
            <Meta
              items={[
                <span>{inst.version} · {loaderLabel(inst)}</span>,
                inst.loader !== "vanilla" && <span>{plural(snapshot?.modCounts[inst.id] ?? 0, "mod")}</span>,
                <span>{lastPlayed(inst.lastPlayed)}</span>,
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
