import { useEffect, useState } from "react";
import { installWithDependencies, searchMods, type ModHit } from "@/api/modrinth";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { useDebounced } from "@/hooks/useDebounced";
import { compact, errorMessage, LOADERS } from "@/lib/format";
import type { Instance, Loader } from "@/types";

const CATEGORIES: [string, string][] = [
  ["", "All"],
  ["optimization", "Performance"],
  ["utility", "Utility"],
  ["worldgen", "Worldgen"],
  ["decoration", "Decoration"],
  ["library", "Libraries"],
];

type InstallState = { status: "installing" } | { status: "installed" } | { status: "failed"; error: string };

export function ModBrowser({ instance, onInstalled }: { instance: Instance; onInstalled(): void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [hits, setHits] = useState<ModHit[] | null>(null);
  const [error, setError] = useState("");
  const [installs, setInstalls] = useState<Record<string, InstallState>>({});
  const debounced = useDebounced(query.trim(), 300);

  // Depend on the fields, not the object: snapshots recreate instances on every refresh.
  const { version, loader } = instance;
  useEffect(() => {
    let stale = false;
    setHits(null);
    setError("");
    searchMods({ version, loader }, debounced, category).then(
      (h) => !stale && setHits(h),
      (e) => !stale && setError(`Modrinth search failed: ${errorMessage(e)}`)
    );
    return () => {
      stale = true;
    };
  }, [version, loader, debounced, category]);

  async function install(projectId: string) {
    setInstalls((s) => ({ ...s, [projectId]: { status: "installing" } }));
    try {
      await installWithDependencies(projectId, instance);
      setInstalls((s) => ({ ...s, [projectId]: { status: "installed" } }));
      onInstalled();
    } catch (e) {
      setInstalls((s) => ({ ...s, [projectId]: { status: "failed", error: errorMessage(e) } }));
    }
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <label className="search">
          <Icon name="travel_explore" />
          <input className="input" placeholder="Search mods on Modrinth" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="pills">
          {CATEGORIES.map(([key, label]) => (
            <button key={key} className="pill" aria-pressed={category === key} onClick={() => setCategory(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pane-list">
        {error ? (
          <Banner message={error} />
        ) : !hits ? (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 96, flexShrink: 0 }} />)
        ) : !hits.length ? (
          <EmptyState icon="search_off">
            No mods found for {instance.version} · {LOADERS[instance.loader]}.
          </EmptyState>
        ) : (
          hits.map((h) => <ModCard key={h.project_id} hit={h} instance={instance} state={installs[h.project_id]} onInstall={install} />)
        )}
      </div>
    </div>
  );
}

function ModCard({ hit, instance, state, onInstall }: { hit: ModHit; instance: Instance; state?: InstallState; onInstall(id: string): void }) {
  const loaders = hit.categories.filter((c): c is Loader => c in LOADERS).map((c) => LOADERS[c]);
  return (
    <div className="card">
      <div className="card-top">
        <div className="mod-main">
          <div className="mod-icon">{hit.icon_url ? <img src={hit.icon_url} alt="" loading="lazy" /> : <Icon name="extension" />}</div>
          <div className="mod-text">
            <div className="mod-name">
              {hit.title} <span className="by">by {hit.author}</span>
            </div>
            <p className="mod-desc">{hit.description}</p>
          </div>
        </div>
        {state?.status === "installed" ? (
          <button className="btn small installed" disabled>
            <Icon name="check" />
            Installed
          </button>
        ) : (
          <button
            className="btn small"
            disabled={state?.status === "installing"}
            title={state?.status === "failed" ? state.error : undefined}
            onClick={() => onInstall(hit.project_id)}
          >
            <Icon name={state?.status === "installing" ? "progress_activity" : "download"} spin={state?.status === "installing"} />
            {state?.status === "installing" ? "Installing" : state?.status === "failed" ? "Retry" : "Install"}
          </button>
        )}
      </div>
      <div className="card-foot mono">
        <span><Icon name="download" />{compact(hit.downloads)}</span>
        <span className="chip">{loaders.join(", ") || LOADERS[instance.loader]}</span>
      </div>
    </div>
  );
}
