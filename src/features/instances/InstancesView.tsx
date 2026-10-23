import { useMemo, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { LOADERS, recency } from "@/lib/format";
import { useLauncher, type PendingImport } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance, Loader } from "@/types";
import { InstancePage } from "./InstancePage";
import { InstanceRow } from "./InstanceRow";
import "./instances.css";
import { Select } from "@/components/ui/Select";

type Sort = "played" | "name" | "time";
const SORTERS: Record<Sort, (a: Instance, b: Instance) => number> = {
  played: (a, b) => recency(b) - recency(a),
  name: (a, b) => a.name.localeCompare(b.name),
  time: (a, b) => b.playSeconds - a.playSeconds,
};
const FILTERS: ("all" | Loader)[] = ["all", "vanilla", "fabric", "quilt"];

export function InstancesView() {
  const { snapshot, error, clearError, launch, imports } = useLauncher();
  const { openNewInstance, navigate } = useUi();
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState<"all" | Loader>("all");
  const [sort, setSort] = useState<Sort>("played");
  const [openId, setOpenId] = useState<string | null>(null);
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

  const opened = all.find((i) => i.id === openId);

  return (
    <section className="view">
      {opened && <InstancePage instance={opened} onBack={() => setOpenId(null)} />}
      <div className="page" hidden={!!opened}>
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
            <button className="btn" onClick={openNewInstance}>
              <Icon name="add" />
              Create instance
            </button>
          </div>
        </div>

        <div className="rows">
          {imports.map((p) => <ImportRow key={p.projectId} pending={p} />)}
          {!all.length ? (
            !imports.length && (
              <EmptyState
                icon="layers"
                action={
                  <div className="empty-actions">
                    <button className="btn primary" onClick={() => navigate("modpacks")}><Icon name="inventory_2" />Browse modpacks</button>
                    <button className="btn" onClick={openNewInstance}><Icon name="add" />Blank instance</button>
                  </div>
                }
              >
                No instances yet. Start from a ready-made Modrinth modpack, or a blank game with your own mods.
              </EmptyState>
            )
          ) : !list.length ? (
            <EmptyState icon="search_off">Nothing matches this filter.</EmptyState>
          ) : (
            list.map((i) => <InstanceRow key={i.id} instance={i} onOpen={() => setOpenId(i.id)} />)
          )}
        </div>

        <div className="page-foot">
          <span>Java: <b>managed by launcher</b></span>
          <span className="mono selectable">{snapshot?.dataDir}</span>
        </div>
      </div>
    </section>
  );
}

/** A modpack still downloading; replaced by the real instance row once it lands. */
function ImportRow({ pending: p }: { pending: PendingImport }) {
  const { startImport, dismissImport } = useLauncher();
  const pct = p.total ? (p.done / p.total) * 100 : 0;
  return (
    <div className="row import-row" role="status" aria-busy={!p.error}>
      <div className="row-main">
        <div className="row-icon">{p.iconUrl ? <img src={p.iconUrl} alt="" /> : <Icon name="inventory_2" />}</div>
        <div className="row-text">
          <div className="row-title">
            <strong>{p.title}</strong>
            {p.version && <span className="chip tag">{p.version.game_versions.at(-1)}</span>}
            {p.version && <span className="chip">{p.version.version_number}</span>}
          </div>
          {p.error ? (
            <div className="meta small" style={{ color: "var(--critical)" }}>{p.error}</div>
          ) : (
            <div className="import-progress">
              <div className={`bar ${p.total ? "" : "indeterminate"}`}>
                <div style={p.total ? { transform: `scaleX(${pct / 100})` } : undefined} />
              </div>
              <span className="meta small mono">{p.total ? `${p.done} / ${p.total} files` : "Preparing…"}</span>
            </div>
          )}
        </div>
      </div>
      {p.error && (
        <div className="row-actions">
          <button
            className="btn"
            onClick={() => startImport({ project_id: p.projectId, title: p.title, icon_url: p.iconUrl }, p.version)}
          >
            <Icon name="refresh" />
            Retry
          </button>
          <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => dismissImport(p.projectId)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
