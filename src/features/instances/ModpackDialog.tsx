import { useEffect, useRef, useState } from "react";
import { importModpack, searchModpacks, type ModHit } from "@/api/modrinth";
import { Banner } from "@/components/ui/Banner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { useDebounced } from "@/hooks/useDebounced";
import { compact, errorMessage } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import "@/features/mods/mods.css";

/** Search Modrinth modpacks and turn one into a new instance. */
export function ModpackDialog({ onClose }: { onClose(): void }) {
  const { refresh, select } = useLauncher();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ModHit[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const debounced = useDebounced(query.trim(), 300);

  useEffect(() => ref.current?.showModal(), []);

  useEffect(() => {
    let stale = false;
    setHits(null);
    searchModpacks(debounced).then(
      (h) => !stale && setHits(h),
      (e) => !stale && setError(`Modrinth search failed: ${errorMessage(e)}`)
    );
    return () => {
      stale = true;
    };
  }, [debounced]);

  async function install(projectId: string) {
    setBusy(projectId);
    setError("");
    try {
      const inst = await importModpack(projectId);
      select(inst.id);
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog ref={ref} className="modpack-dialog" onClose={onClose}>
      <form method="dialog">
        <h2>Modrinth modpacks</h2>
        <label className="search">
          <Icon name="travel_explore" />
          <input className="input" placeholder="Search Fabric and Quilt modpacks" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {error && <Banner message={error} />}
        <div className="modpack-list">
          {!hits ? (
            Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 96, flexShrink: 0 }} />)
          ) : !hits.length ? (
            <EmptyState icon="search_off">No modpacks found.</EmptyState>
          ) : (
            hits.map((h) => (
              <div key={h.project_id} className="card">
                <div className="card-top">
                  <div className="mod-main">
                    <div className="mod-icon">{h.icon_url ? <img src={h.icon_url} alt="" loading="lazy" /> : <Icon name="inventory_2" />}</div>
                    <div className="mod-text">
                      <div className="mod-name">
                        {h.title} <span className="by">by {h.author}</span>
                      </div>
                      <p className="mod-desc">{h.description}</p>
                    </div>
                  </div>
                  <button type="button" className="btn small" disabled={!!busy} onClick={() => install(h.project_id)}>
                    <Icon name={busy === h.project_id ? "progress_activity" : "download"} spin={busy === h.project_id} />
                    {busy === h.project_id ? "Installing" : "Install"}
                  </button>
                </div>
                <div className="card-foot mono">
                  <span><Icon name="download" />{compact(h.downloads)}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn">Close</button>
        </div>
      </form>
    </dialog>
  );
}
