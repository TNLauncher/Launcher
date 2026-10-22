import { useCallback, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { useLauncher, useRecentInstances } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import { InstalledMods } from "./InstalledMods";
import { ModBrowser } from "./ModBrowser";
import "./mods.css";

/** Two panes for one modded instance: installed jars and Modrinth search. */
export function ModsView() {
  const { selected } = useLauncher();
  const { openNewInstance } = useUi();
  const recent = useRecentInstances();
  const modded = useMemo(() => recent.filter((i) => i.loader !== "vanilla"), [recent]);
  const [pickedId, setPickedId] = useState<string>();
  // Bumped after installs so the installed list reloads.
  const [revision, setRevision] = useState(0);
  const onInstalled = useCallback(() => setRevision((r) => r + 1), []);

  const instance = useMemo(
    () => modded.find((i) => i.id === pickedId) ?? modded.find((i) => i.id === selected?.id) ?? modded[0],
    [modded, pickedId, selected]
  );

  if (!instance) {
    return (
      <section className="view mods">
        <EmptyState
          icon="extension_off"
          action={<button className="btn primary" onClick={openNewInstance}><Icon name="add" />Create instance</button>}
        >
          Mods need a Fabric or Quilt instance.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="view mods">
      <div className="split">
        <InstalledMods
          key={`${instance.id}:${revision}`}
          instance={instance}
          picker={
            <select className="select" aria-label="Instance" value={instance.id} onChange={(e) => setPickedId(e.target.value)}>
              {modded.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          }
        />
        <ModBrowser key={instance.id} instance={instance} onInstalled={onInstalled} />
      </div>
    </section>
  );
}
