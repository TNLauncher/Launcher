import { lazy, Suspense, useMemo, useState } from "react";
import { View } from "@/components/layout/View";
import { Banner, Button, Chip, EmptyState, Icon, IconButton, Meta, Pill, PillGroup, ProgressBar, SearchInput, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { LOADERS, recency } from "@/lib/format";
import { imports as importStore, useImportProgress, useImports, type PendingImport } from "@/store/imports";
import { useLauncher } from "@/store/LauncherContext";
import { useUi } from "@/store/UiContext";
import type { Instance, Loader } from "@/types";
import { InstanceRow } from "./InstanceRow";
import s from "./instances.module.css";

// The page pulls in content browsing, screenshots and per-instance settings; warmed when a row is hovered.
const loadPage = () => import("./InstancePage");
const InstancePage = lazy(() => loadPage().then((m) => ({ default: m.InstancePage })));

type Sort = "played" | "name" | "time";
const SORTERS: Record<Sort, (a: Instance, b: Instance) => number> = {
  played: (a, b) => recency(b) - recency(a),
  name: (a, b) => a.name.localeCompare(b.name),
  time: (a, b) => b.playSeconds - a.playSeconds,
};
const FILTERS: ("all" | Loader)[] = ["all", ...(Object.keys(LOADERS) as Loader[])];

export function InstancesView() {
  const { snapshot, error, clearError, launch } = useLauncher();
  const imports = useImports();
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
    <View>
      {opened && (
        <Suspense>
          <InstancePage instance={opened} onBack={() => setOpenId(null)} />
        </Suspense>
      )}
      <div className={s.page} hidden={!!opened} onPointerOver={loadPage} onFocus={loadPage}>
        {error && <Banner message={error.message} onRetry={() => launch(error.id)} onDismiss={clearError} />}
        <div className={s.toolbar}>
          <div className={s.toolbarLeft}>
            <SearchInput className={s.search} label="Filter instances" value={query} onChange={setQuery} />
            <div className={s.vsep} />
            <PillGroup label="Loader">
              {FILTERS.filter((k) => k === "all" || counts[k]).map((k) => (
                <Pill key={k} pressed={loader === k} onClick={() => setLoader(k)} count={counts[k] ?? 0}>
                  {k === "all" ? "All" : LOADERS[k]}
                </Pill>
              ))}
            </PillGroup>
          </div>
          <div className={s.toolbarRight}>
            <Select label="Sort" value={sort} onChange={setSort}
              options={[
                { value: "played", label: "Last played" },
                { value: "name", label: "Name" },
                { value: "time", label: "Play time" },
              ]} />
            <Button icon="add" onClick={openNewInstance}>
              Create instance
            </Button>
          </div>
        </div>

        <div className={s.rows}>
          {imports.map((p) => <ImportRow key={p.projectId} pending={p} />)}
          {!all.length ? (
            !imports.length && (
              <EmptyState
                icon="layers"
                action={
                  <div className={s.emptyActions}>
                    <Button variant="primary" icon="inventory_2" onClick={() => navigate("modpacks")}>Browse modpacks</Button>
                    <Button icon="add" onClick={openNewInstance}>Blank instance</Button>
                  </div>
                }
              >
                No instances yet. Start from a ready-made modpack, or a blank game with your own mods.
              </EmptyState>
            )
          ) : !list.length ? (
            <EmptyState icon="search_off">Nothing matches this filter.</EmptyState>
          ) : (
            list.map((i) => <InstanceRow key={i.id} instance={i} onOpen={() => setOpenId(i.id)} />)
          )}
        </div>

        <div className={s.pageFoot}>
          <span>Java: <b>managed by launcher</b></span>
          <span className="mono selectable">{snapshot?.dataDir}</span>
        </div>
      </div>
    </View>
  );
}

/** A modpack still downloading; replaced by the real instance row once it lands. */
function ImportRow({ pending: p }: { pending: PendingImport }) {
  const { startImport } = useLauncher();
  const { done, total } = useImportProgress(p.projectId);
  const pct = total ? (done / total) * 100 : 0;
  return (
    <div className={cx(s.row, s.importRow)} role="status" aria-busy={!p.error}>
      <div className={s.rowMain}>
        <div className={s.rowIcon}>{p.iconUrl ? <img src={p.iconUrl} alt="" /> : <Icon name="inventory_2" />}</div>
        <div className={s.rowText}>
          <div className={s.rowTitle}>
            <strong>{p.title}</strong>
            {p.version && <Chip variant="tag">{p.version.gameVersions.at(-1)}</Chip>}
            {p.version && <Chip>{p.version.number}</Chip>}
          </div>
          {p.error ? (
            <Meta small className={s.error} items={[p.error]} />
          ) : (
            <div className={s.importProgress}>
              <ProgressBar value={total ? pct / 100 : undefined} />
              <Meta small className="mono" items={[total ? `${done} / ${total} files` : "Preparing…"]} />
            </div>
          )}
        </div>
      </div>
      {p.error && (
        <div className={s.rowActions}>
          <Button icon="refresh" onClick={() => startImport(p.source, { id: p.projectId, title: p.title, iconUrl: p.iconUrl }, p.version)}>
            Retry
          </Button>
          <IconButton icon="close" label="Dismiss" onClick={() => importStore.dismiss(p.projectId)} />
        </div>
      )}
    </div>
  );
}
