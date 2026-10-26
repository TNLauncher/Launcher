import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { lazy, Suspense, useCallback, useMemo } from "react";
import { View } from "@/components/layout/View";
import { sources } from "@/api/sources";
import { Banner, Button, Chip, EmptyState, Icon, IconButton, Meta, Pill, PillGroup, ProgressBar, SearchInput, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { LOADERS, recency } from "@/lib/format";
import { imports as importStore, useImportProgress, useImports, type PendingImport } from "@/store/imports";
import { useLauncher } from "@/store/LauncherContext";
import { useRouteState, useUi } from "@/store/UiContext";
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
const EMPTY: Instance[] = [];

export function InstancesView() {
  const all = useLauncher((st) => st.snapshot?.instances) ?? EMPTY;
  const dataDir = useLauncher((st) => st.snapshot?.dataDir);
  const error = useLauncher((st) => st.error);
  const clearError = useLauncher((st) => st.clearError);
  const launch = useLauncher((st) => st.launch);
  const startFileImport = useLauncher((st) => st.startFileImport);
  const imports = useImports();
  const openedId = useUi((st) => st.route.instance);
  const openNewInstance = useUi((st) => st.openNewInstance);
  const navigate = useUi((st) => st.navigate);
  const back = useUi((st) => st.back);
  const [query, setQuery] = useRouteState("instances.query", "");
  const [loader, setLoader] = useRouteState<"all" | Loader>("instances.loader", "all");
  const [sort, setSort] = useRouteState<Sort>("instances.sort", "played");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    all.forEach((i) => (c[i.loader] = (c[i.loader] ?? 0) + 1));
    return c;
  }, [all]);

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      all
        .filter((i) => (loader === "all" || i.loader === loader) && (!q || `${i.name} ${i.version}`.toLowerCase().includes(q)))
        .sort(SORTERS[sort]),
    [all, loader, q, sort]
  );
  const groupNames = useMemo(() => [...new Set(all.map((i) => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);
  // Ungrouped first, then groups by name; without groups the list stays flat.
  const sections = useMemo(
    () => (groupNames.length ? ["", ...groupNames].map((g) => ({ group: g, items: list.filter((i) => i.group === g) })).filter((x) => x.items.length) : []),
    [groupNames, list]
  );
  const importFile = () =>
    pickFile({ filters: [{ name: "Modpack", extensions: ["mrpack", "zip"] }] }).then((path) => path && startFileImport(path));

  const opened = openedId ? all.find((i) => i.id === openedId) : undefined;
  const openInstance = useCallback((id: string) => navigate("instances", { instance: id }), [navigate]);

  return (
    <View>
      {opened && (
        <Suspense>
          <InstancePage instance={opened} onBack={back} />
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
            <Button icon="upload_file" title="Install a modpack archive from disk (.mrpack, .zip)" onClick={importFile}>
              Import
            </Button>
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
          ) : sections.length ? (
            sections.map(({ group, items }) => (
              <details key={group} className={s.section} open>
                <summary>
                  <Icon name="chevron_right" className={s.sectionChevron} />
                  {group || "Ungrouped"}
                  <span className="mono">{items.length}</span>
                </summary>
                <div className={s.rows}>
                  {items.map((i) => <InstanceRow key={i.id} instance={i} groups={groupNames} onOpen={openInstance} />)}
                </div>
              </details>
            ))
          ) : (
            list.map((i) => <InstanceRow key={i.id} instance={i} groups={groupNames} onOpen={openInstance} />)
          )}
        </div>

        <div className={s.pageFoot}>
          <span>Java: <b>managed by launcher</b></span>
          <span className="mono selectable">{dataDir}</span>
        </div>
      </div>
    </View>
  );
}

/** A modpack still downloading; replaced by the real instance row once it lands. */
function ImportRow({ pending: p }: { pending: PendingImport }) {
  const startImport = useLauncher((st) => st.startImport);
  const startFileImport = useLauncher((st) => st.startFileImport);
  const { done, total, manual } = useImportProgress(p.projectId);
  const pct = total ? (done / total) * 100 : 0;
  const waiting = manual.filter((f) => !f.done).length;
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
          {!p.error && waiting > 0 && (
            <Button variant="link" className={s.manualLink} onClick={() => importStore.showManual(p.projectId)}>
              {waiting === 1 ? "1 file needs" : `${waiting} files need`} downloading by hand
            </Button>
          )}
        </div>
      </div>
      {!p.error && (
        <div className={s.rowActions}>
          <IconButton icon="close" label="Cancel" onClick={() => sources.cancelImport(p.projectId)} />
        </div>
      )}
      {p.error && (
        <div className={s.rowActions}>
          <Button icon="refresh" onClick={() => (p.file ? startFileImport(p.projectId) : startImport(p.source, { id: p.projectId, title: p.title, iconUrl: p.iconUrl }, p.version))}>
            Retry
          </Button>
          <IconButton icon="close" label="Dismiss" onClick={() => importStore.dismiss(p.projectId)} />
        </div>
      )}
    </div>
  );
}
