import { Button, Meta } from "@/components/ui";
import { useChanged } from "@/hooks/useChanged";
import { cx } from "@/lib/cx";
import { lastPlayed, loaderLabel, plural } from "@/lib/format";
import { useLauncher, useSelectedInstance } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./home.module.css";

export function Hero() {
  const inst = useSelectedInstance();
  const modCount = useLauncher((st) => (inst ? st.snapshot?.modCounts[inst.id] ?? 0 : 0));
  const openNewInstance = useUi((st) => st.openNewInstance);
  const restage = useChanged(inst?.id);

  return (
    <div className={cx(s.hero, restage && s.restage)}>
      {/* Keyed by instance: switching re-stages the scene instead of swapping text in place. */}
      <div key={inst?.id} className={s.heroBg} />
      <div key={`body-${inst?.id}`} className={s.heroBody}>
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
                inst.loader !== "vanilla" && <span>{plural(modCount, "mod")}</span>,
                <span>{lastPlayed(inst.lastPlayed)}</span>,
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
