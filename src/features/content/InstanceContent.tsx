import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { memo, useCallback, useRef, useState } from "react";
import { launcher } from "@/api/launcher";
import { sources, type Hit, type SourceInfo } from "@/api/sources";
import { Banner, Button, Chip, ConfirmDialog, EmptyState, Icon, IconButton, Pill, PillGroup, SearchInput, Skeleton, Switch, Tab, Tabs } from "@/components/ui";
import { cx } from "@/lib/cx";
import { Screenshots } from "@/features/screenshots/Screenshots";
import { useDebounced } from "@/hooks/useDebounced";
import { useSource } from "@/hooks/useSource";
import { compact, errorMessage, megabytes } from "@/lib/format";
import { useLauncher } from "@/store/LauncherContext";
import type { ContentKind, Instance } from "@/types";
import { label, useContent, type ContentItem } from "./useContent";
import s from "./content.module.css";

interface KindInfo {
  label: string;
  /** Lower-case noun for sentences. */
  noun: string;
  icon: string;
  folder: string;
}

const KINDS: Record<ContentKind, KindInfo> = {
  mod: {
    label: "Mods",
    noun: "mods",
    icon: "extension",
    folder: "mods",
  },
  resourcepack: {
    label: "Resource packs",
    noun: "resource packs",
    icon: "texture",
    folder: "resourcepacks",
  },
  shader: {
    label: "Shaders",
    noun: "shaders",
    icon: "wb_twilight",
    folder: "shaderpacks",
  },
};
const ORDER: ContentKind[] = ["mod", "resourcepack", "shader"];
/** Iris, the Fabric/Quilt shader loader, on Modrinth. */
const IRIS = { source: "modrinth", project: "YL57xq9U" };

/** Mods, resource packs, shaders and screenshots of one instance: what is installed, and a content source to add more. */
export function InstanceContent({ instance }: { instance: Instance }) {
  const modded = instance.loader !== "vanilla";
  const [tab, setTab] = useState<ContentKind | "screenshots">(modded ? "mod" : "resourcepack");
  const kind = tab === "screenshots" ? "mod" : tab;
  const content = { mod: useContent(instance.id, "mod"), resourcepack: useContent(instance.id, "resourcepack"), shader: useContent(instance.id, "shader") };
  const current = content[kind];
  const source = useSource();
  const needsLoader = kind !== "resourcepack" && !modded;
  const irisMissing =
    kind === "shader" && modded && source?.id === IRIS.source && !!content.mod.items && !content.mod.identifying && !content.mod.installedProjects.has(IRIS.project);

  return (
    <div>
      <Tabs label="Instance content">
        {ORDER.map((k) => (
          <Tab key={k} selected={tab === k} onSelect={() => setTab(k)} icon={KINDS[k].icon} count={content[k].items?.length ?? ""}>
            {KINDS[k].label}
          </Tab>
        ))}
        <Tab selected={tab === "screenshots"} onSelect={() => setTab("screenshots")} icon="photo_camera">
          Screenshots
        </Tab>
      </Tabs>

      {tab === "screenshots" ? (
        <Screenshots instanceId={instance.id} />
      ) : needsLoader ? (
        <EmptyState icon={KINDS[kind].icon}>
          Vanilla can't load {KINDS[kind].noun}. Create a Fabric or Quilt instance to use them.
        </EmptyState>
      ) : (
        <>
          {irisMissing && <IrisNotice instance={instance} onInstalled={content.mod.reload} />}
          <div className={s.contentSplit}>
            <InstalledPane key={kind} instance={instance} kind={kind} content={current} sourceName={source?.name} />
            {source ? (
              <BrowsePane key={`${source.id}-${kind}`} source={source} instance={instance} kind={kind} installed={current.installedProjects} onInstalled={current.reload} />
            ) : (
              <EmptyState icon="extension_off">Turn on a content source in Settings → Plugins to add {KINDS[kind].noun}.</EmptyState>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function IrisNotice({ instance, onInstalled }: { instance: Instance; onInstalled(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const install = () => {
    setBusy(true);
    setError("");
    sources
      .installContent(IRIS.source, instance.id, "mod", IRIS.project)
      .then(onInstalled, (e) => setError(`Could not install Iris: ${errorMessage(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className={s.contentNotice} role="status">
      <Icon name={error ? "error" : "info"} />
      <span>{error || "Shaders need the Iris mod (with Sodium). Without it this folder is ignored."}</span>
      <Button variant="primary" size="sm" icon="download" loading={busy} onClick={install}>
        Install Iris
      </Button>
    </div>
  );
}

function InstalledPane({ instance, kind, content, sourceName }: { instance: Instance; kind: ContentKind; content: ReturnType<typeof useContent>; sourceName?: string }) {
  const { refresh, isRunning } = useLauncher();
  // The game rewrites options.txt and Iris' config on exit, and Windows locks loaded jars.
  const running = isRunning(instance.id);
  const info = KINDS[kind];
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<ContentItem | null>(null);
  const { items } = content;

  const act = (action: Promise<void>) =>
    action
      .then(() => setError(""))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => {
        content.reload();
        refresh();
      });

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter((i) => !q || `${label(i)} ${i.file}`.toLowerCase().includes(q));
  const enabled = items?.filter((i) => i.enabled).length ?? 0;

  return (
    <section className={s.cpane} aria-label={`Installed ${info.noun}`}>
      <div className={s.cpaneHead}>
        <div className={s.cpaneTitle}>
          <h3>Installed</h3>
          {items && (
            <span className="mono">
              {enabled}
              {enabled !== items.length && ` / ${items.length}`}
            </span>
          )}
          {content.identifying && (
            <span className={s.identifying}>
              <Icon name="progress_activity" spin />
              Matching with {sourceName}
            </span>
          )}
          <IconButton icon="folder_open" label={`Open ${info.folder} folder`} className={s.pushEnd} onClick={() => act(launcher.openInstanceDir(instance.id, info.folder))} />
        </div>
        {!!items?.length && (
          <SearchInput label={`Filter installed ${info.noun}`} placeholder={`Filter ${info.noun}`} value={filter} onChange={setFilter} />
        )}
        {running && <span className={s.identifying}>Close the game to change installed {info.noun}.</span>}
        {(error || content.error) && <Banner message={error || errorMessage(content.error)} onDismiss={() => setError("")} />}
      </div>

      <fieldset className={s.cpaneList} disabled={running}>
        {!items ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className={s.listSkeleton} height={52} />)
        ) : !items.length ? (
          <EmptyState icon={info.icon}>No {info.noun} yet. Find some on the right.</EmptyState>
        ) : !shown.length ? (
          <EmptyState icon="search_off">Nothing matches “{filter}”.</EmptyState>
        ) : (
          shown.map((i) => (
            <div key={i.file} className={cx(s.citem, !i.enabled && s.off)}>
              <ItemIcon item={i} instanceId={instance.id} kind={kind} />
              <div className={s.citemText}>
                <div className={s.citemName}>
                  <b title={i.project?.description}>{label(i)}</b>
                  {!i.enabled && <Chip className={s.smallChip}>Disabled</Chip>}
                </div>
                <span className={cx(s.citemSub, "mono")} title={i.file}>
                  {i.versionNumber && <>{i.versionNumber} · </>}
                  {megabytes(i.size)}
                  {!i.project && !content.identifying && sourceName && ` · not on ${sourceName}`}
                </span>
              </div>
              <div className={s.citemActions}>
                <IconButton icon="delete" label={`Remove ${label(i)}`} title="Remove" variant="danger" className={s.reveal} onClick={() => setRemoving(i)} />
                <Switch label={`${i.enabled ? "Disable" : "Enable"} ${label(i)}`} checked={i.enabled} onChange={() => act(launcher.toggleContent(instance.id, kind, i.file))} />
              </div>
            </div>
          ))
        )}
      </fieldset>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing ? label(removing) : ""}?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) act(launcher.deleteContent(instance.id, kind, removing.file));
          setRemoving(null);
        }}
      >
        <span className="mono">{removing?.file}</span> is deleted from the {info.folder} folder.
      </ConfirmDialog>
    </section>
  );
}

function ItemIcon({ item, instanceId, kind }: { item: ContentItem; instanceId: string; kind: ContentKind }) {
  const src = item.project?.iconUrl ?? (kind === "mod" ? launcher.modIconUrl(instanceId, item.file) : null);
  // The jar icon is tried before the source answers; remember a failure per URL so the source's one still shows.
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={s.citemIcon}>
      <Icon name={KINDS[kind].icon} />
      {src && src !== failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />}
    </span>
  );
}

type InstallState = "installing" | "installed" | { error: string };

function BrowsePane(p: { source: SourceInfo; instance: Instance; kind: ContentKind; installed: Set<string>; onInstalled(): void }) {
  const { source, instance, kind, installed, onInstalled } = p;
  const info = KINDS[kind];
  const categories = [{ id: "", label: "All" }, ...(source.categories[kind] ?? [])];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [installs, setInstalls] = useState<Record<string, InstallState>>({});
  const debounced = useDebounced(query.trim(), 300);
  const { version, loader } = instance;
  // Read at click time so `install` stays stable while identification is still filling the set.
  const installedRef = useRef(installed);
  installedRef.current = installed;

  const hits = useQuery({
    queryKey: ["browse", source.id, kind, version, loader, debounced, category],
    queryFn: () =>
      sources
        .search(source.id, { kind, query: debounced, gameVersion: version, loader, categories: category ? [category] : [], limit: 30 })
        .then((page) => page.hits),
    placeholderData: keepPreviousData,
  });

  // Stable so memoized cards skip re-rendering while the user types.
  const install = useCallback(
    async (projectId: string) => {
      setInstalls((s) => ({ ...s, [projectId]: "installing" }));
      try {
        // Dependencies already present (any version) are skipped instead of landing as a second jar.
        await sources.installContent(source.id, instance.id, kind, projectId, [...installedRef.current]);
        setInstalls((s) => ({ ...s, [projectId]: "installed" }));
        onInstalled();
      } catch (e) {
        setInstalls((s) => ({ ...s, [projectId]: { error: errorMessage(e) } }));
      }
    },
    [source.id, instance.id, kind, onInstalled]
  );

  return (
    <section className={s.cpane} aria-label={`Add ${info.noun} from ${source.name}`}>
      <div className={s.cpaneHead}>
        <div className={s.cpaneTitle}>
          <h3>Add from {source.name}</h3>
          <span className="mono">{version}</span>
        </div>
        <SearchInput icon="travel_explore" label={`Search ${info.noun} on ${source.name}`} placeholder={`Search ${info.noun}`} value={query} onChange={setQuery} />
        <PillGroup label="Category" wrap className={s.cats}>
          {categories.map((c) => (
            <Pill key={c.id} pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}
            </Pill>
          ))}
        </PillGroup>
      </div>

      <div className={cx(s.cpaneList, hits.isPlaceholderData && s.stale)}>
        {hits.isError ? (
          <Banner message={`${source.name} search failed: ${errorMessage(hits.error)}`} onRetry={() => hits.refetch()} />
        ) : !hits.data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className={s.listSkeleton} height={84} />)
        ) : !hits.data.length ? (
          <EmptyState icon="search_off">No {info.noun} for Minecraft {version}{debounced && ` match “${debounced}”`}.</EmptyState>
        ) : (
          hits.data.map((h) => (
            <ResultCard key={h.id} hit={h} icon={info.icon} state={installed.has(h.id) ? "installed" : installs[h.id]} onInstall={install} />
          ))
        )}
      </div>
    </section>
  );
}

const ResultCard = memo(function ResultCard({ hit, icon, state, onInstall }: { hit: Hit; icon: string; state?: InstallState; onInstall(id: string): void }) {
  const failed = typeof state === "object";
  return (
    <div className={s.cresult}>
      <span className={cx(s.citemIcon, s.big)}>{hit.iconUrl ? <img src={hit.iconUrl} alt="" loading="lazy" /> : <Icon name={icon} />}</span>
      <div className={s.citemText}>
        <div className={s.citemName}>
          <b>{hit.title}</b>
          <span className={s.by}>by {hit.author}</span>
        </div>
        <p className={s.cresultDesc}>{hit.description}</p>
        <span className={cx(s.citemSub, "mono")}><Icon name="download" />{compact(hit.downloads)}</span>
      </div>
      {state === "installed" ? (
        <Button size="sm" icon="check" className={cx(s.cresultBtn, s.installed)} disabled>
          Installed
        </Button>
      ) : (
        <Button
          size="sm"
          icon={failed ? "refresh" : "download"}
          className={s.cresultBtn}
          loading={state === "installing"}
          title={failed ? state.error : undefined}
          aria-label={`Install ${hit.title}`}
          onClick={() => onInstall(hit.id)}
        >
          {state === "installing" ? "Installing" : failed ? "Retry" : "Install"}
        </Button>
      )}
    </div>
  );
});
