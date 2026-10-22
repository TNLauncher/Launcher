import { useMemo, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { LOADERS } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance, Loader } from "@/types";
import { InstanceRow } from "./InstanceRow";
import { ModpackDialog } from "./ModpackDialog";
import "./instances.css";
import { Select } from "@/components/ui/Select";

type Sort = "played" | "name" | "time";
const SORTERS: Record<Sort, (a: Instance, b: Instance) => number> = {
  played: (a, b) => b.lastPlayed - a.lastPlayed,
  name: (a, b) => a.name.localeCompare(b.name),
  time: (a, b) => b.playSeconds - a.playSeconds,
};
const FILTERS: ("all" | Loader)[] = ["all", "vanilla", "fabric", "quilt"];

export function InstancesView() {
  const { snapshot, error, clearError, launch } = useLauncher();
  const { openNewInstance } = useUi();
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState<"all" | Loader>("all");
  const [sort, setSort] = useState<Sort>("played");
  const [importing, setImporting] = useState(false);
  const all = snapshot?.instances ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    all.forEach((i) => (c[i.loader] = (c[i.loader] ?? 0) + 1));
    return c;
  }, [all]);

  const q = query.trim().toLowerCase();
  const list = all
    .filter((i) => (loader === "all" || i.loader === loader) && (!q || `${i.name} ${i.version}`.toLowerCase().includes(q)))
    .sort(SORTERS[sort]);

  return (
    <section className="view">
      <div className="page">
        {error && <Banner message={error.message} onRetry={() => launch(error.id)} onDismiss={clearError} />}
        <div className="toolbar">
          <div className="toolbar-left">
            <label className="search">
              <Icon name="search" />
              <input className="input" placeholder="Filter instances" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="vsep" />
            <div className="pills">
              {FILTERS.filter((k) => k === "all" || counts[k]).map((k) => (
                <button key={k} className="pill" aria-pressed={loader === k} onClick={() => setLoader(k)}>
                  {k === "all" ? "All" : LOADERS[k]}
                  <span className="mono">{counts[k] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar-right">
            <Select label="Sort" value={sort} onChange={setSort}
              options={[
                { value: "played", label: "Last played" },
                { value: "name", label: "Name" },
                { value: "time", label: "Play time" },
              ]} />
            <button className="btn" onClick={() => setImporting(true)}>
              <Icon name="travel_explore" />
              Modrinth modpack
            </button>
            <button className="btn" onClick={openNewInstance}>
              <Icon name="add" />
              Create instance
            </button>
          </div>
        </div>

        <div className="rows">
          {!all.length ? (
            <EmptyState
              icon="layers"
              action={<button className="btn primary" onClick={openNewInstance}><Icon name="add" />Create instance</button>}
            >
              No instances yet. Each instance is a separate game folder with its own version, mods and worlds.
            </EmptyState>
          ) : !list.length ? (
            <EmptyState icon="search_off">Nothing matches this filter.</EmptyState>
          ) : (
            list.map((i) => <InstanceRow key={i.id} instance={i} />)
          )}
        </div>

        <div className="page-foot">
          <span>Java: <b>managed by launcher</b></span>
          <span className="mono selectable">{snapshot?.dataDir}</span>
        </div>
      </div>
      {importing && <ModpackDialog onClose={() => setImporting(false)} />}
    </section>
  );
}
