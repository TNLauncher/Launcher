import { Button, Icon, SectionHead } from "@/components/ui";
import { useChanged } from "@/hooks/useChanged";
import { cx } from "@/lib/cx";
import { LOADER_ICON, LOADERS } from "@/lib/format";
import { useLauncher, useRecentInstances } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import s from "./home.module.css";

export function InstanceTiles() {
  const { selected, select } = useLauncher();
  const { openNewInstance, navigate } = useUi();
  const recent = useRecentInstances();
  const picked = useChanged(selected?.id);

  return (
    <div className={s.section}>
      <SectionHead
        title="Instances"
        action={recent.length > 0 && (
          <Button variant="link" onClick={() => navigate("instances")}>
            {recent.length > 3 ? `All ${recent.length} instances` : "Manage"}
          </Button>
        )}
      />
      <div className={cx(s.tiles, picked && s.picked)}>
        {recent.slice(0, 3).map((i) => (
          <button key={i.id} className={cx(s.tile, "sheen")} aria-pressed={i.id === selected?.id} onClick={() => select(i.id)}>
            <span className={s.tileIcon}>{i.icon ? <img src={i.icon} alt="" /> : <Icon name={LOADER_ICON[i.loader]} />}</span>
            <span className={s.tileText}>
              <span className={s.tileName}>{i.name}</span>
              <span className={s.tileSub}>{i.version} · {LOADERS[i.loader]}</span>
            </span>
          </button>
        ))}
        <button className={cx(s.tile, s.add, "sheen")} onClick={openNewInstance}>
          <span className={s.tileIcon}><Icon name="add" /></span>
          <span className={s.tileText}>
            <span className={s.tileName}>Add instance</span>
            <span className={s.tileSub}>Vanilla, Fabric or Quilt</span>
          </span>
        </button>
      </div>
    </div>
  );
}
